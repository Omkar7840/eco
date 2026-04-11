# Auth Service — Comprehensive Technical Documentation

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [System Architecture](#2-system-architecture)
3. [Data Flow](#3-data-flow)
4. [Tech Stack](#4-tech-stack)
5. [Project Structure](#5-project-structure)
6. [Core Functionality](#6-core-functionality)
7. [APIs & Integrations](#7-apis--integrations)
8. [Database Design](#8-database-design)
9. [Setup & Installation](#9-setup--installation)
10. [User Flow](#10-user-flow)
11. [Edge Cases & Limitations](#11-edge-cases--limitations)
12. [Performance & Scalability](#12-performance--scalability)
13. [Future Improvements](#13-future-improvements)
14. [Summary](#14-summary)

---

## 1. Executive Overview

### 1.1 What is the Auth Service?

The **Auth Service** is a dedicated microservice within the Sarvm backend ecosystem that is solely responsible for **authentication and authorization** across all Sarvm client applications. It acts as the **gateway layer** — every single HTTP request that arrives at the platform first passes through this service. If the request targets an auth-specific endpoint (e.g., token generation), the service processes it directly. If the request is destined for any other microservice (retailer_service, order_service, catalogue_mgmt_service, user_mgmt_service), the auth service **verifies the JWT token** and then **proxies the request** downstream through an internal load balancer.

### 1.2 Why Does It Exist as a Separate Service?

- **Single Responsibility**: Instead of baking auth logic into every microservice, a single centralized service handles all token issuance, verification, and decoding. This ensures DRY (Don't Repeat Yourself) principles across the backend.
- **API Gateway Pattern**: The auth service doubles as an API gateway. All external traffic enters through port `3200`, gets authenticated, and is then proxied to the appropriate internal service. This means downstream services never need to directly validate JWTs themselves.
- **Multi-App Support**: Sarvm serves multiple client applications — `retailerApp`, `householdApp`, `logisticsDelivery`, and `admin`. Each app has different user types, scopes, and token payloads. The auth service centralizes this multi-tenant logic.
- **Security Boundary**: By concentrating all credential and token operations in one place, the attack surface is minimized. The JWT secret (`HS256_TOKEN_SECRET`) only exists in this service's environment.

### 1.3 What Client Applications Does It Serve?

| App Name           | User Type Mapped        | Segment ID              | Scope                      |
|--------------------|-------------------------|-------------------------|-----------------------------|
| `retailerApp`      | `RETAILER`              | `retailer`              | `['Users', 'retailerApp']`  |
| `householdApp`     | Original `userType`     | `household` / `sales_employee_sh` / `sales_employee_sso` / `sales_employee_co` | `['Users', 'householdApp']` |
| `logisticsDelivery`| `LOGISTICS_DELIVERY`    | `logistics_delivery`    | `['Users', 'logisticsDelivery']` |
| `admin`            | `ADMIN`                 | User's admin role (e.g., `super_admin`) or `non-admin` | `['ADMIN']` |

### 1.4 The Dual Role

The Auth Service operates in **two simultaneous modes**:

1. **Auth API Server** — Exposes REST endpoints under `/auth/apis/v1/` for token generation, unauthenticated token generation, and healthcheck.
2. **Reverse Proxy / API Gateway** — Any request that does NOT match an auth route is intercepted, its JWT is verified, and the request is proxied to the `INTERNAL_LOAD_BALANCER` target via `http-proxy-middleware`.

---

## 2. System Architecture

### 2.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATIONS                         │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────┐ ┌─────────────┐  │
│  │ Retailer App │ │ Household App│ │ Logistics  │ │  Admin App  │  │
│  └──────┬───────┘ └──────┬───────┘ └─────┬──────┘ └──────┬──────┘  │
│         │                │               │               │         │
└─────────┼────────────────┼───────────────┼───────────────┼─────────┘
          │                │               │               │
          ▼                ▼               ▼               ▼
    ┌─────────────────────────────────────────────────────────┐
    │              EXTERNAL LOAD BALANCER / API               │
    │                  (api.sarvm.ai / :3200)                  │
    └───────────────────────┬─────────────────────────────────┘
                            │
                            ▼
    ┌─────────────────────────────────────────────────────────┐
    │                   AUTH SERVICE (:3200)                    │
    │                                                          │
    │  ┌────────────────────────────────────────────────────┐  │
    │  │          MIDDLEWARE PIPELINE (in order)             │  │
    │  │                                                    │  │
    │  │  1. express.urlencoded (body parsing, 1MB limit)   │  │
    │  │  2. cors() (allow all origins)                     │  │
    │  │  3. AuthManager.decodeAuthToken (JWT decode)       │  │
    │  │  4. ReqLogger (Pino-based request logging)         │  │
    │  │  5. CLS-Hooked Session (sessionId, clientIp)       │  │
    │  └────────────────────────────────────────────────────┘  │
    │                                                          │
    │  ┌────────────────┐    ┌──────────────────────────────┐  │
    │  │  AUTH ROUTES    │    │    CATCH-ALL PROXY (*)       │  │
    │  │  /auth/apis/*   │    │    verifyToken → proxy →     │  │
    │  │                 │    │    INTERNAL_LOAD_BALANCER     │  │
    │  │  GET /v1/token  │    │                              │  │
    │  │  POST /v1/token │    │    Also: /whs → proxy        │  │
    │  │  GET /v1/       │    │    (WebSocket/WHS support)   │  │
    │  │    unauth_token │    │                              │  │
    │  │  GET /healthchk │    └──────────────────────────────┘  │
    │  └───────┬────────┘                   │                  │
    │          │                            │                  │
    │          ▼                            ▼                  │
    │  ┌───────────────┐    ┌──────────────────────────────┐   │
    │  │  MongoDB       │    │  INTERNAL LOAD BALANCER      │   │
    │  │  (DocumentDB)  │    │  (other microservices)       │   │
    │  │  Database: ums  │    │                              │   │
    │  └───────────────┘    │  ┌─────────────────────────┐  │   │
    │                        │  │ retailer_service        │  │   │
    │                        │  │ user_mgmt_service       │  │   │
    │                        │  │ catalogue_mgmt_service  │  │   │
    │                        │  │ order_service           │  │   │
    │                        │  └─────────────────────────┘  │   │
    │                        └──────────────────────────────┘   │
    └──────────────────────────────────────────────────────────┘
```

### 2.2 Component Breakdown

#### 2.2.1 Entry Point: `server.js`

- **What it does**: Boots the entire application. It imports Express, creates an app instance, calls `InitApp()` to initialize the database and middleware, mounts the route files, sets up the reverse proxy, and starts listening on the configured port.
- **Why it exists**: Separating the server bootstrap from the application logic allows for clean testing (the commented-out `module.exports = app` shows intent for unit test support).
- **Key Operations (in execution order)**:
  1. Registers `module-alias` so that `@controllers`, `@services`, `@db`, etc. path aliases work.
  2. Calls `InitApp(app)` — which connects MongoDB, sets up CLS-hooked session middleware, configures CORS, body parsing, and logging.
  3. After InitApp resolves, additional middleware is applied again at the server level (there is intentional redundancy — CORS and urlencoded parsing are applied both in InitApp and server.js for safety).
  4. Registers `AuthManager.decodeAuthToken` as global middleware — this decodes the JWT from every request's `Authorization` header and attaches it to `req.authPayload`.
  5. Mounts the auth API routes under `config.node.pathPrefix` (which resolves to `/auth/apis`).
  6. Sets up a proxy for `/whs` (warehouse/webhook service) that forwards to the internal load balancer with WebSocket support.
  7. Sets up a wildcard catch-all (`app.all('*')`) that: first calls `AuthController.verifyToken()` to validate the JWT, and if valid, proxies the request to the internal load balancer.
  8. Registers 404 and global error handlers.
  9. Listens on `HOST_PORT` (default `3200`).

#### 2.2.2 Application Initializer: `src/InitApp/index.js`

- **What it does**: A factory function that receives the Express `app` object and wires up foundational middleware and the database connection.
- **Why it exists**: Encapsulates startup concerns (DB connection, session creation, process-level error handlers) away from the route/server logic. This ensures the database is connected before any request handling begins (the function is `async` and the server only starts after it resolves).
- **Key Operations**:
  1. **AuthManager.decodeAuthToken** — Applied as the first middleware to decode incoming JWTs.
  2. **CLS-Hooked Session** — Creates a continuation-local storage namespace (`logger_session`) for request-scoped context. Each request gets a `sessionId` (either from the `sessionid` header or auto-generated via `cuid()`) and a `clientIp` (from `clientip` header, `X-Forwarded-For`, or the server's own IP). This enables request tracing across async operations.
  3. **Body Parsing** — `express.urlencoded` with 1MB limit and extended parsing enabled.
  4. **CORS** — Enabled for all origins.
  5. **Request Logging** — Uses `ReqLogger` from `sarvm-utility` (Pino-based), conditionally skipped in test mode.
  6. **MongoDB Connection** — Instantiates the singleton `DB` class and calls `connect()`.
  7. **Process-level Error Handlers** — Catches `unhandledRejection` (logs it) and `uncaughtException` (logs it and exits with code 1).

#### 2.2.3 Service Layer Architecture

The service uses a **Controller → Service → Manager/DB** layered architecture:

```
Route Handler (Auth.js in routes/v1/)
    │
    ▼
Controller (Auth.js in controllers/v1/)
    │  - Business logic orchestration
    │  - User lookup from DB
    │  - Payload construction per app type
    │  - Calls external services (RMS for shop data, LMS for logistics data)
    │
    ▼
Service (Auth.js in services/v1/)
    │  - Thin wrapper around AuthManager
    │  - Calls AuthManager.issueTokens() or AuthManager.verifyToken()
    │
    ▼
AuthManager (common/libs/AuthManager/)
    │  - JWT signing & verification using jsonwebtoken
    │  - Token decoding middleware
    │  - Scope-based authorization middleware
    │
    ▼
MongoDB (via Mongoose - apis/db/)
    │  - User model lookup (findById)
    │  - Singleton connection pattern
```

---

## 3. Data Flow

### 3.1 Token Generation Flow (Authenticated User)

This is triggered when a client calls `GET /auth/apis/v1/token/:userId`:

```
Client (e.g., Retailer App)
    │
    │  GET /auth/apis/v1/token/63300cb5ea6a3078062a23fc
    │  Headers: { app_name: "retailerApp", app_version_code: 101, authorization: "Bearer <existing_token>" }
    │
    ▼
server.js — Middleware Pipeline
    │
    ├─ 1. express.urlencoded() — parse body
    ├─ 2. cors() — add CORS headers
    ├─ 3. AuthManager.decodeAuthToken — extracts JWT from Authorization header,
    │     verifies it against HS256_TOKEN_SECRET, attaches decoded payload to req.authPayload.
    │     If token type is 'accessToken' and expired → throws ACCESSTOKEN_EXP_ERROR.
    │     If token type is 'refreshToken' and expired → throws REFRESHTOKEN_EXP_ERROR.
    │     If no token present → calls next() silently (anonymous access allowed for some routes).
    ├─ 4. ReqLogger — logs the incoming request
    │
    ▼
routes/v1/Auth.js — handleRESTReq wrapper
    │
    │  Extracts from req: { app_name, app_version_code, authorization } from headers,
    │  body, params (userId), query — merges all into a single dataValues object.
    │
    ▼
controllers/v1/Auth.js — getToken(dataValues)
    │
    ├─ 1. Retrieves the singleton DB instance: db.getInstance()
    ├─ 2. Queries MongoDB: Users.findById(userId)
    │     - If user is null/undefined → throws INTERNAL_SERVER_ERROR("user does not exists")
    │
    ├─ 3. Determines which payload generator to use based on app_name:
    │     ┌──────────────────────────────────────────────────────────────────┐
    │     │ app_name            │ Generator Function       │ Extra API Call │
    │     │─────────────────────│──────────────────────────│────────────────│
    │     │ "retailerApp"       │ generateRetailerData()   │ RMS (Shop)     │
    │     │ "admin"             │ generateAdminData()      │ None           │
    │     │ "logisticsDelivery" │ generateLogisticData()   │ LMS (Profile)  │
    │     │ Anything else       │ generateGeneralData()    │ None           │
    │     └──────────────────────────────────────────────────────────────────┘
    │
    ├─ 4. For retailerApp specifically:
    │     a. Calls sarvm-utility's apiServices.rms.getAllShopViaUserId({ headers, body })
    │        - This makes an HTTP call to the Retailer Management Service (RMS)
    │        - Returns shop data: shop_id, id, isKYCVerified, isSubscribed, GST_no
    │     b. Constructs shopMeta with flags: { onBoarding, isSubscribed, GST_no, isKYCVerified }
    │     c. Payload includes: entityType="SU", entityId=shopId, shopId, shopUniqueId, shopMeta
    │
    ├─ 5. For logisticsDelivery:
    │     a. Calls logisticInformation(userId) which makes:
    │        GET ${INTERNAL_LOAD_BALANCER}/lms/apis/v1/profile/${userId}
    │     b. Extracts deliveryData: { onbording, subscribed }
    │     c. Payload includes: entityType="LU", entityId=userId, onbording, subscribed
    │
    ├─ 6. For admin:
    │     a. Reads adminData from user document: { status, role }
    │     b. Segment is determined by admin role if status is "active", else "non-admin"
    │     c. Scope is ['ADMIN'] instead of ['Users', app_name]
    │
    ├─ 7. Common payload fields across all generators:
    │     - userId, phone, userType (mapped via getUserType), segmentId (via getSegment)
    │     - flyyUserId: `${app_name.slice(0, -3)}-${flyyUserId}` (e.g., "retailer-abc123")
    │     - isEmployee: userType.includes('EMPLOYEE')
    │     - scope: ['Users', app_name] (or ['ADMIN'] for admin)
    │
    ▼
services/v1/Auth.js — issueToken(payload)
    │
    │  Delegates to AuthManager.issueTokens(payload)
    │
    ▼
common/libs/AuthManager/index.js — issueTokens(payload)
    │
    ├─ 1. Validates payload is not null/undefined → throws UNAUTH_USER if so
    ├─ 2. Creates accessToken options:
    │     { subject: 'accessToken', algorithm: 'HS256', expiresIn: '365d',
    │       notBefore: '120ms', issuer: 'sarvm:ums' }
    ├─ 3. Creates refreshToken options:
    │     { ...accessTokenOptions, subject: 'refreshToken', expiresIn: '365d' }
    ├─ 4. Signs accessToken with FULL payload using jwt.sign(payload, HS256_TOKEN_SECRET, options)
    ├─ 5. Signs refreshToken with MINIMAL payload: { userId, scope: [] }
    ├─ 6. If logisticsDelivery: adds { onbording, subscribed } to response body
    │
    ▼
Response returned to client:
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "body": {}  // or { onbording, subscribed } for logistics
  }
}
```

### 3.2 Unauthenticated Token Flow

Triggered via `GET /auth/apis/v1/unauth_token`:

```
Client (any app, not logged in)
    │
    │  GET /auth/apis/v1/unauth_token
    │  Headers: { app_name: "retailerApp", app_version_code: 101 }
    │
    ▼
controllers/v1/Auth.js — getUnauthorizeToken(dataValues)
    │
    │  Creates a minimal payload: { userId: 'anonymous', scope: [app_name] }
    │  No database lookup occurs.
    │  No external API calls are made.
    │
    ▼
AuthManager.issueTokens(payload)
    │
    │  Signs tokens with the anonymous payload.
    │  The resulting JWT has limited scope — only the app_name is in scope.
    │
    ▼
Response: { success: true, data: { accessToken, refreshToken, body: {} } }
```

**Why this exists**: Before a user logs in (e.g., on the OTP screen), the client still needs a token to make API calls to endpoints like "send OTP". This anonymous token has restricted scope so it can only access pre-auth endpoints.

### 3.3 Token Verification / Proxy Flow (Non-Auth Routes)

Any request that does NOT match `/auth/apis/*` hits the wildcard handler in `server.js`:

```
Client
    │
    │  GET /retailer/apis/v1/shops (example non-auth route)
    │  Headers: { authorization: "Bearer <jwt_token>" }
    │
    ▼
server.js — Middleware Pipeline (same as above)
    │
    ├─ AuthManager.decodeAuthToken runs → attaches req.authPayload
    │
    ▼
server.js — app.all('*') catch-all
    │
    ├─ 1. AuthController.verifyToken(dataValues)
    │     - Extracts JWT from Authorization header: authString.split(' ')[1]
    │     - Calls AuthService.verifyToken(jwtToken)
    │       → Calls AuthManager.verifyToken(token)
    │         → jwt.verify(token, HS256_TOKEN_SECRET)
    │     - If valid → returns true
    │     - If invalid/expired → throws error → caught by error handler
    │
    ├─ 2. If verification passes → next() is called
    │
    ▼
createProxyMiddleware(options)
    │
    │  Proxies the entire request (method, headers, body) to:
    │  target: INTERNAL_LOAD_BALANCER (e.g., http://localhost or http://internal-lb.sarvm.ai)
    │  changeOrigin: true (rewrites Host header)
    │  ws: true (WebSocket proxying enabled)
    │
    ▼
Downstream microservice (retailer_service, order_service, etc.)
```

### 3.4 WebSocket / WHS Proxy Flow

```
Client
    │
    │  Any request to /whs/*
    │
    ▼
server.js — app.use('/whs', createProxyMiddleware(options))
    │
    │  This proxy does NOT verify tokens.
    │  Directly forwards to INTERNAL_LOAD_BALANCER.
    │  WebSocket upgrade headers are supported (ws: true).
    │
    ▼
Warehouse/Webhook Service
```

**Why /whs bypasses auth**: The WHS endpoint is mounted BEFORE the `app.all('*')` catch-all. Routes are matched in order in Express, so `/whs` requests are proxied directly without token verification. This is a deliberate design choice — the `/whs` service likely handles its own authentication or is only accessible internally.

---

## 4. Tech Stack

### 4.1 Runtime & Framework

| Technology | Version | Purpose | Why This Was Chosen |
|---|---|---|---|
| **Node.js** | 18.20.5 (prod), 17.9.1 (dev/staging) | JavaScript runtime | Non-blocking I/O is ideal for a proxy service that mostly forwards requests. Node's event loop efficiently handles thousands of concurrent proxy connections. |
| **Express.js** | ^4.18.1 | HTTP framework | Industry standard for Node.js REST APIs. Middleware pipeline architecture is perfect for the auth → verify → proxy pattern. |

### 4.2 Authentication & Security

| Technology | Version | Purpose | Why This Was Chosen |
|---|---|---|---|
| **jsonwebtoken** | ^8.5.1 | JWT signing, verification, decoding | De-facto standard for JWT operations in Node.js. Supports HS256 algorithm used here. |
| **bcrypt** | ^5.0.1 | Password hashing (available but not actively used in current routes) | Industry standard for password hashing with salt rounds. Listed as dependency for future use or shared utility. |
| **cors** | ^2.8.5 | Cross-Origin Resource Sharing | Enables browser-based clients to make API calls from different domains. Currently configured with default (allow all origins). |

### 4.3 Database

| Technology | Version | Purpose | Why This Was Chosen |
|---|---|---|---|
| **Mongoose** | ^6.10.0 | MongoDB ODM (Object Document Mapper) | Provides schema validation, type casting, and query building for MongoDB. Used for the User model. |
| **MongoDB / Amazon DocumentDB** | — | Primary database | The DB URL in `.dev.env` points to `dev-db.cluster-c6vufvons2bc.ap-south-1.docdb.amazonaws.com` — this is Amazon DocumentDB, which is MongoDB-compatible. Chosen for its schema-flexible document model and AWS managed infrastructure. |
| **Knex** | ^2.0.0 | SQL query builder (legacy/unused) | Present in dependencies and migration scripts but currently commented out in config. Indicates the service previously used or was planned to use MySQL. |
| **mysql** | ^2.18.1 | MySQL driver (legacy/unused) | Same as Knex — a leftover from a previous architecture or a planned migration. |
| **Objection.js** | ^3.0.1 | ORM for SQL (legacy/unused) | Another SQL-oriented dependency that is not actively used. |

### 4.4 Proxy & Networking

| Technology | Version | Purpose | Why This Was Chosen |
|---|---|---|---|
| **http-proxy-middleware** | ^2.0.6 | Reverse proxy for non-auth requests | Enables the auth service to act as an API gateway. Supports WebSocket proxying, header manipulation, and target URL rewriting. |
| **axios** | ^1.3.4 | HTTP client for internal service calls | Used for inter-service communication (e.g., calling the Logistics Management Service). Clean promise-based API. |

### 4.5 Utilities & Logging

| Technology | Version | Purpose | Why This Was Chosen |
|---|---|---|---|
| **sarvm-utility** | v5.0.3 (from AWS CodeCommit) | Shared utility package | A private npm package hosted on AWS CodeCommit. Provides: `Logger` (Pino-based), `ReqLogger`, `ErrorHandler` (custom error classes like `INTERNAL_SERVER_ERROR`, `ACCESSTOKEN_EXP_ERROR`, `UNAUTH_USER`), `AuthManager` (token decode middleware), `HttpResponseHandler`, and `apiServices` (pre-built API clients for inter-service calls like `rms.getAllShopViaUserId`). |
| **cuid** | ^3.0.0 | Collision-resistant unique IDs | Used to generate session IDs when the client doesn't provide one. CUIDs are horizontally scalable and sortable. |
| **uuid** | ^8.3.2 | Universal unique IDs | Available as a dependency, though `cuid` is the one actively used for session IDs. |
| **cls-hooked** | (via sarvm-utility/InitApp) | Continuation-Local Storage | Enables request-scoped context (session ID, client IP) to be available across async operations without passing through function parameters. Critical for structured logging. |
| **moment** | ^2.29.3 | Date/time manipulation | Available as dependency (not actively used in current code). |
| **morgan** | ^1.10.0 | HTTP request logger | Present but commented out — replaced by `ReqLogger` from `sarvm-utility` (Pino-based). |
| **joi** | ^17.6.0 | Schema validation | Used in the Validation module for input validation. Defines schemas for user data (fullName, email, mobile, city). Currently the route handler accepts a `validationSchema` parameter but doesn't enforce it. |
| **dotenv** | ^16.0.1 | Environment variable loading | Loads `.env` files based on the run script (`.lcl.env`, `.dev.env`, `.stg.env`, `.prd.env`). |
| **module-alias** | ^2.2.2 | Path alias resolution | Maps `@controllers`, `@services`, `@db`, `@models`, `@routes`, `@constants`, `@config`, `@common` to their actual paths. Eliminates brittle relative imports like `../../../`. |
| **swagger-ui-express** | ^4.6.0 | API documentation UI | Serves the OpenAPI 3.0 spec at `/auth/apis/apidocs` as an interactive Swagger UI. |
| **lodash** | (via sarvm-utility) | Utility functions | Used for `_.isUndefined()` and `_.get()` in the InitApp module for safe property access. |
| **ip** | (via sarvm-utility) | IP address utility | Used as a fallback to get the server's own IP when the client doesn't provide one. |

### 4.6 DevOps & Infrastructure

| Technology | Version | Purpose | Why This Was Chosen |
|---|---|---|---|
| **Docker** | — | Containerization | Multi-stage builds: Stage 1 (`node:18.20.5`) installs dependencies with `npm ci --production`, Stage 2 (`node:18.20.5-alpine`) copies artifacts for a minimal production image. Exposes port 3200. |
| **AWS ECR** | — | Docker image registry | Dev/staging Dockerfiles reference `326457620362.dkr.ecr.ap-south-1.amazonaws.com/node:17.9.1` — images are hosted on AWS Elastic Container Registry in `ap-south-1` (Mumbai). |
| **AWS DocumentDB** | — | Managed MongoDB-compatible database | Connection strings point to `.docdb.amazonaws.com` clusters in `ap-south-1`. |
| **AWS CodeCommit** | — | Git repository for sarvm-utility | The shared utility package is hosted on `git-codecommit.ap-south-1.amazonaws.com`. |
| **nodemon** | ^2.0.16 | Auto-restart on file changes | Used in all development run scripts (`lcl`, `stg`, `prd`) for hot-reloading during development. |
| **ESLint** | ^8.15.0 | Code linting | Configured with `airbnb-base` and `prettier` plugins. Enforces code quality. |
| **Prettier** | ^2.6.2 | Code formatting | Works alongside ESLint for consistent code style. |

### 4.7 Why Each Key Dependency Exists

- **`sarvm-utility`** is the linchpin — it's a monorepo-style shared package that prevents code duplication across all 5 backend services. Both the auth service and downstream services import the same `ErrorHandler`, `Logger`, and `AuthManager`. However, the auth service also has its own **local copy** of `AuthManager` in `src/common/libs/AuthManager/`. The local copy is the one actually used for token issuance (referenced by `@common/libs`), while the `sarvm-utility` version handles the global `decodeAuthToken` middleware and error classes.

---

## 5. Project Structure

### 5.1 Complete File Tree

```
auth_service/
├── .dev.env                     # Development environment variables (DocumentDB dev cluster)
├── .dockerignore                # Files excluded from Docker builds
├── .env.example                 # Template for new developers
├── .eslintignore                # Files excluded from ESLint
├── .eslintrc.json               # ESLint configuration (airbnb-base + prettier)
├── .git/                        # Git repository
├── .gitignore                   # Git-ignored files (node_modules, env files, logs, etc.)
├── .lcl.env                     # Local environment variables (localhost MongoDB)
├── .prd.env                     # Production environment variables (placeholder MONGO_URL)
├── .prettierignore              # Files excluded from Prettier
├── .prettierrc                  # Prettier configuration
├── .stg.env                     # Staging environment variables (DocumentDB UAT cluster)
├── Dockerfile                   # Production Docker image (node:18.20.5, multi-stage)
├── Dockerfile.dev               # Development Docker image (ECR-hosted node:17.9.1)
├── Dockerfile.staging           # Staging Docker image (ECR-hosted node:17.9.1)
├── README.md                    # Contains a Mermaid architecture diagram
├── jsconfig.json                # IDE path alias configuration (mirrors _moduleAliases)
├── package-lock.json            # Locked dependency tree
├── package.json                 # Dependencies, scripts, module aliases
├── server.js                    # APPLICATION ENTRY POINT — boots Express, mounts routes & proxy
│
└── src/
    ├── InitApp/
    │   └── index.js             # Application initializer — DB connection, middleware setup, CLS sessions
    │
    ├── apis/
    │   ├── controllers/
    │   │   └── v1/
    │   │       ├── Auth.js      # CORE CONTROLLER — getToken, verifyToken, getUnauthorizeToken, generateToken
    │   │       └── index.js     # Barrel export
    │   │
    │   ├── db/
    │   │   └── index.js         # MongoDB Singleton connection class using Mongoose
    │   │
    │   ├── models/
    │   │   └── Users.js         # Mongoose User schema — phone, username, refreshTokenTimestamp, basicInformation, etc.
    │   │
    │   ├── routes/
    │   │   ├── index.js         # Root router — mounts /healthcheck, /apidocs, /v1 routes
    │   │   └── v1/
    │   │       ├── Auth.js      # Route definitions — GET /token/:userId, POST /token, GET /unauth_token
    │   │       └── index.js     # Barrel export — mounts AuthRouter at /
    │   │
    │   └── services/
    │       └── v1/
    │           ├── Auth.js      # Service layer — thin wrapper for issueToken & verifyToken
    │           ├── index.js     # Barrel export
    │           └── Logistic/
    │               └── index.js # Logistics service integration — calls LMS API for delivery data
    │
    ├── common/
    │   ├── helper/
    │   │   └── index.js         # Exports AccessEnv (duplicate of utility)
    │   │
    │   ├── libs/
    │   │   ├── AuthManager/
    │   │   │   └── index.js     # LOCAL JWT MANAGER — issueTokens, verifyToken, decodeAuthToken, requiresScopes
    │   │   ├── ErrorHandler/
    │   │   │   ├── index.js     # Custom AppError class with handleError method
    │   │   │   └── reqToCurl.js # Converts Express req object to cURL command for debugging
    │   │   ├── HttpResponseHandler.js  # Static success/error response formatter
    │   │   ├── Logger/
    │   │   │   └── all-the-logs.log    # Log output file
    │   │   ├── Logger.js        # Simple alias: module.exports = console
    │   │   ├── RequestHandler.js # Axios-based HTTP client singleton for inter-service calls
    │   │   ├── Validation/
    │   │   │   ├── Schemas.js   # Joi schema for user validation (fullName, email, mobile, city)
    │   │   │   └── Validation.js # Middleware factory for request body validation
    │   │   ├── authorization.js # Legacy JWT helper (hardcoded secrets, not used in production)
    │   │   └── index.js         # Barrel export for all libs
    │   │
    │   └── utility/
    │       ├── AccessEnv.js     # Environment variable accessor with caching
    │       └── index.js         # Barrel export
    │
    ├── config/
    │   └── index.js             # Central configuration — reads env vars, exports structured config object
    │
    ├── constants/
    │   ├── errorConstants/
    │   │   ├── authErrors.js    # Auth error codes: ACCESSTOKEN_EXP_ERROR, REFRESHTOKEN_EXP_ERROR, UNAUTH_USER
    │   │   ├── index.js         # Merges all error codes and handling
    │   │   ├── otpErrors.js     # OTP error codes: SEND_OTP_ERROR, VERIFY_OTP_ERROR
    │   │   └── serverErrors.js  # Server error codes: INTERNAL_SERVER_ERROR, PAGE_NOT_FOUND_ERROR, etc.
    │   └── index.js             # Barrel export for all constants
    │
    ├── openapi/
    │   └── openapi.json         # OpenAPI 3.0.3 specification — documents all auth endpoints
    │
    └── scripts/
        ├── migrateLatest.js     # Knex migration runner (points to ../knex/migrations — not present)
        ├── migrateMake.js       # Knex migration creator
        └── migrateRollback.js   # Knex migration rollback
```

### 5.2 Module Alias Mapping

Defined in `package.json` under `_moduleAliases` and mirrored in `jsconfig.json`:

| Alias | Actual Path | Usage |
|---|---|---|
| `@root` | `.` (project root) | Accessing root-level files |
| `@controllers` | `src/apis/controllers` | Importing controller modules |
| `@services` | `src/apis/services` | Importing service modules |
| `@db` | `src/apis/db` | Importing the DB singleton |
| `@models` | `src/apis/models` | Importing Mongoose models |
| `@routes` | `src/apis/routes` | Importing route modules |
| `@constants` | `src/constants` | Importing error codes and constants |
| `@config` | `src/config` | Importing configuration |
| `@common` | `src/common` | Importing shared utilities, libs, helpers |

### 5.3 Layered Architecture Pattern

Each feature follows a strict **Route → Controller → Service → Manager/DB** pattern:

```
                     ┌──────────────────────────┐
                     │        ROUTES             │
                     │  (HTTP method + path)     │
                     │  Extracts req data         │
                     │  Calls controller method   │
                     └───────────┬──────────────┘
                                 │
                     ┌───────────▼──────────────┐
                     │      CONTROLLERS          │
                     │  (Business orchestration) │
                     │  DB queries               │
                     │  External API calls       │
                     │  Payload construction     │
                     └───────────┬──────────────┘
                                 │
                     ┌───────────▼──────────────┐
                     │       SERVICES            │
                     │  (Thin delegation layer)  │
                     │  Calls AuthManager        │
                     └───────────┬──────────────┘
                                 │
                     ┌───────────▼──────────────┐
                     │     AUTH MANAGER           │
                     │  (JWT operations)          │
                     │  jwt.sign / jwt.verify     │
                     └──────────────────────────┘
```

---

## 6. Core Functionality

### 6.1 JWT Token Issuance

**File**: [src/common/libs/AuthManager/index.js](src/common/libs/AuthManager/index.js)  
**Method**: `AuthManager.issueTokens(payload)`

#### 6.1.1 How It Works

1. **Input Validation**: If `payload` is null or undefined, an `UNAUTH_USER` error is thrown immediately. This is a guard against accidentally issuing tokens with empty payloads.

2. **Access Token Creation**:
   - **Algorithm**: `HS256` (HMAC with SHA-256). This is a symmetric algorithm — the same secret is used for both signing and verification. Chosen because all token verification happens within the auth service itself (no need for public-key distribution).
   - **Secret**: Read from `HS256_TOKEN_SECRET` environment variable (value: `sarvm`).
   - **Expiry**: Read from `ACCESS_TOKEN_EXPIRESIN` (value: `365d` — 1 year).
   - **Not Before**: `120ms` — the token is not valid for the first 120 milliseconds after issuance. This prevents race conditions where a token is used before it's fully propagated.
   - **Issuer**: `sarvm:ums` — identifies the token as being issued by the User Management System.
   - **Subject**: `accessToken` — embedded in the JWT as the `sub` claim. Used during decoding to differentiate access tokens from refresh tokens.
   - **Payload**: The FULL user-specific payload (userId, phone, userType, segmentId, shopId, etc.) is embedded in the access token.

3. **Refresh Token Creation**:
   - **Same options as access token** except:
     - **Subject**: `refreshToken`
     - **Expiry**: Read from `REFRESH_TOKEN_EXPIRESIN` (also `365d`)
   - **Payload**: MINIMAL — only `{ userId, scope: [] }`. The refresh token intentionally contains less data for security. If a refresh token is compromised, the attacker only gets the userId, not the full user profile.

4. **Special Logistics Handling**: If `payload.scope[1] === "logisticsDelivery"`, the response body includes `{ onbording, subscribed }` flags. These are extracted from the Logistics Management Service and returned alongside the tokens so the client can immediately determine the user's onboarding status without a separate API call.

5. **Return Value**: An `Object.freeze()` frozen object containing `{ accessToken, refreshToken, body }`. Freezing prevents accidental mutation of the token response.

#### 6.1.2 JWT Token Structure

When decoded, an access token looks like:

```json
{
  "userId": "63300cb5ea6a3078062a23fc",
  "phone": "9876543210",
  "userType": "RETAILER",
  "segmentId": "retailer",
  "flyyUserId": "retailer-abc123",
  "isEmployee": false,
  "shopId": "shop_001",
  "shopUniqueId": "unique_001",
  "entityType": "SU",
  "entityId": "shop_001",
  "shopMeta": {
    "shop": { /* full shop object from RMS */ },
    "flag": { "onBoarding": true, "isSubscribed": true, "GST_no": true, "isKYCVerified": true }
  },
  "scope": ["Users", "retailerApp"],
  "iat": 1680000000,
  "exp": 1711536000,
  "nbf": 1680000000,
  "sub": "accessToken",
  "iss": "sarvm:ums"
}
```

### 6.2 JWT Token Verification

**Method**: `AuthManager.verifyToken(token)`

- Simply calls `jwt.verify(token, HS256_TOKEN_SECRET)`.
- If the token is valid → returns `true`.
- If the token is expired, malformed, or signature doesn't match → throws an error which is caught by the error middleware.
- This method is used by the proxy catch-all in `server.js` to gate all non-auth requests.

### 6.3 JWT Token Decoding (Middleware)

**Method**: `AuthManager.decodeAuthToken(req, res, next)`

This is an Express middleware that runs on **every single request**:

1. Reads `req.headers.authorization` (e.g., `"accessToken eyJhbG..."` or `"Bearer eyJhbG..."`).
2. If no authorization header → calls `next()` silently (allows unauthenticated requests to reach the unauth_token endpoint).
3. Splits the header by space:
   - `jwtSubject` = first part (e.g., `"accessToken"` or `"Bearer"`)
   - `jwtToken` = second part (the actual JWT string)
4. If no token part → calls `next()` silently.
5. Calls `jwt.verify(jwtToken, HS256_TOKEN_SECRET)`:
   - **Success**: Checks if `decoded.sub === jwtSubject`. If match, attaches `decoded` to `req.authPayload` and calls `next()`.
   - **Failure (accessToken)**: Throws `ACCESSTOKEN_EXP_ERROR`.
   - **Failure (refreshToken)**: Throws `REFRESHTOKEN_EXP_ERROR`.

**Why subject matching matters**: The header format is intentionally `"accessToken <token>"` or `"refreshToken <token>"` (NOT `"Bearer <token>"`). This allows the middleware to know whether the client is sending an access token or a refresh token, and throw the appropriate error type so the client knows whether to refresh or re-login.

### 6.4 Scope-Based Authorization

**Method**: `AuthManager.requiresScopes(scopes)`

A middleware factory that returns an Express middleware:

1. Reads `req.authPayload` (set by `decodeAuthToken`).
2. If no payload exists → throws `ACCESSTOKEN_EXP_ERROR` (assumption: missing payload means expired/missing token).
3. Normalizes `authPayload.scope` to an array.
4. Checks if there's any intersection between the request's scopes and the required scopes.
5. If at least one scope matches → calls `next()`.
6. If no scope matches → throws `UNAUTH_USER`.

**Example usage** (not currently used in auth service routes but available for downstream services):
```javascript
router.get('/admin/dashboard', AuthManager.requiresScopes(['ADMIN']), handler);
```

### 6.5 User Type Resolution

**Function**: `getUserType(appName, userType)` in controllers/v1/Auth.js

Maps the `app_name` header to a standardized user type string:

| app_name | Returned userType |
|---|---|
| `retailerApp` | `'RETAILER'` (hardcoded, ignores DB userType) |
| `logisticsDelivery` | `'LOGISTICS_DELIVERY'` (hardcoded) |
| `admin` | `'ADMIN'` (hardcoded) |
| Anything else | Original `userType` from the DB user document |

### 6.6 Segment Resolution

**Function**: `getSegment({ user, app_name })` in controllers/v1/Auth.js

Determines the user's segment ID for analytics/targeting purposes:

| app_name | Condition | Returned segmentId |
|---|---|---|
| `retailerApp` | Always | `'retailer'` |
| `householdApp` | userType === 'EMPLOYEE_SH' | `'sales_employee_sh'` |
| `householdApp` | userType === 'EMPLOYEE_SSO' | `'sales_employee_sso'` |
| `householdApp` | userType === 'EMPLOYEE_CO' | `'sales_employee_co'` |
| `householdApp` | Default | `'household'` |
| `logisticsDelivery` | Always | `'logistics_delivery'` |
| `admin` | adminData.status === 'active' | `user.adminData.role` (dynamic) |
| `admin` | adminData.status !== 'active' | `'non-admin'` |
| Anything else | — | Throws `INTERNAL_SERVER_ERROR` |

### 6.7 Flyy User ID Construction

For each token payload, a `flyyUserId` is generated:

```javascript
flyyUserId: `${app_name.slice(0, -3)}-${flyyUserId}`
```

- `app_name.slice(0, -3)` removes the last 3 characters:
  - `retailerApp` → `retailer`
  - `householdApp` → `household`
  - `logisticsDelivery` → `logisticsDeliv` (note: this might be unintentional)
  - `admin` → `ad` (note: only 5 chars, removing 3 leaves `ad`)
- Prepended to the user's `flyyUserId` from the DB with a hyphen.
- **Purpose**: Creates a namespaced Flyy (gamification/loyalty platform) user ID unique per app.

### 6.8 Error Handling

The service uses a multi-layered error handling approach:

#### 6.8.1 Custom Error Classes (from `sarvm-utility`)

| Error Class | Error Code | HTTP Status | Message |
|---|---|---|---|
| `INTERNAL_SERVER_ERROR` | `INTERNAL_SERVER_ERROR` | 500 | Internal Server Error |
| `PAGE_NOT_FOUND_ERROR` | `PAGE_NOT_FOUND_ERROR` | 404 | Page not found |
| `ACCESSTOKEN_EXP_ERROR` | `ACCESSTOKEN_EXP_ERROR` | 200 | Access Token expired |
| `REFRESHTOKEN_EXP_ERROR` | `REFRESHTOKEN_EXP_ERROR` | 200 | Refresh token expired |
| `UNAUTH_USER` | `UNAUTH_USER` | 200 | unauthenticated access detected |
| `BAD_REQUEST_ERROR` | `BAD_REQUEST_ERROR` | 400 | Bad request |

**Note**: Auth errors (`ACCESSTOKEN_EXP_ERROR`, `REFRESHTOKEN_EXP_ERROR`, `UNAUTH_USER`) return HTTP 200 — this is a deliberate design choice. The API always returns 200 for auth errors so the client can parse the response body (which contains `{ success: false, error: { code, message } }`) without dealing with HTTP-level error handling. This is a common pattern in mobile app backends where HTTP errors can be misinterpreted by intermediary proxies.

#### 6.8.2 Error Response Format

```json
// Failure
{
  "success": false,
  "error": {
    "code": "ACCESSTOKEN_EXP_ERROR",
    "message": "Access Token expired"
  }
}
```

#### 6.8.3 Local AppError Class (`src/common/libs/ErrorHandler/index.js`)

A local `AppError` class extends `Error` with:
- `errorCode`: The error constant string
- `originalErr`: The original error object for debugging
- `errData`: Additional context data
- `handleError(req, res)`: Static method that:
  1. Looks up the error code in `ERROR_HANDLING` map to get message and status code
  2. Generates a cURL command from the request for debugging (`reqToCurl`)
  3. Logs the full error with URL, error code, status code, original error message, and cURL
  4. Sends the formatted error response via `HttpResponseHandler.error()`

#### 6.8.4 Global Error Handler (server.js)

```javascript
app.use(async (error, req, res, next) => {
  if (!(error instanceof BaseError)) {
    throw new INTERNAL_SERVER_ERROR();
  } else throw error;
});
```

If an error reaches the global handler:
- If it's a known `BaseError` (from sarvm-utility) → it's re-thrown and handled by `err.handleError(req, res)`
- If it's an unknown error → it's wrapped in `INTERNAL_SERVER_ERROR` and then handled

---

## 7. APIs & Integrations

### 7.1 Exposed REST Endpoints

All auth endpoints are served under the base path `/auth/apis/` (configured by `HOST_SERVICE_NAME=auth` → pathPrefix = `/auth/apis`).

---

#### 7.1.1 Health Check

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/auth/apis/healthcheck` |
| **Auth Required** | No (but `decodeAuthToken` middleware still runs) |
| **Purpose** | Container health probes (Docker, Kubernetes, AWS ECS health checks) |
| **Required Headers** | `app_name` (string), `app_version_code` (integer) |

**Request**:
```http
GET /auth/apis/healthcheck HTTP/1.1
Host: localhost:3200
app_name: retailerApp
app_version_code: 101
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "ts": "2026-04-11T09:00:00.000Z",
    "buildNumber": "101"
  }
}
```

**Internal Logic**:
1. Route defined in `src/apis/routes/index.js`
2. Directly constructs response — no controller/service involvement
3. Returns current timestamp and build number from config
4. Uses `HttpResponseHandler.success()` (from sarvm-utility)

---

#### 7.1.2 Get Token (Authenticated Token Generation)

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/auth/apis/v1/token/:userId` |
| **Auth Required** | Yes (existing JWT in Authorization header) |
| **Purpose** | Generates fresh access + refresh tokens for an authenticated user |
| **Required Headers** | `app_name`, `app_version_code`, `authorization` |
| **Path Params** | `userId` — MongoDB ObjectId of the user |

**Request**:
```http
GET /auth/apis/v1/token/63300cb5ea6a3078062a23fc HTTP/1.1
Host: localhost:3200
app_name: retailerApp
app_version_code: 101
Authorization: accessToken eyJhbGciOiJIUzI1NiIs...
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "body": {}
  }
}
```

**Internal Logic (step by step)**:
1. `routes/v1/Auth.js` — `handleRESTReq` extracts `app_name`, `app_version_code`, `authorization` from `req.headers`, merges with `req.params` (`userId`), `req.body`, `req.query` → `dataValues`
2. `controllers/v1/Auth.js` — `getToken(dataValues)`:
   - Gets `Users` model from `db.getInstance()`
   - `Users.findById(userId)` — MongoDB query
   - If user null → `INTERNAL_SERVER_ERROR("user does not exists")`
   - Constructs `headers` and `body` for potential external API calls
   - **Branching based on app_name**:
     - **retailerApp**: Calls `apiServices.rms.getAllShopViaUserId({ headers, body })` (inter-service HTTP call to Retailer Management Service), constructs `shopMeta`, determines `entityType='SU'`
     - **logisticsDelivery**: Calls `logisticInformation(userId)` → `GET ${INTERNAL_LOAD_BALANCER}/lms/apis/v1/profile/${userId}` (HTTP call to Logistics Management Service), extracts `onbording` and `subscribed` status
     - **admin**: Reads `adminData` from user document directly
     - **other**: Basic payload with user data only
   - Calls `AuthService.issueToken(payload)` → `AuthManager.issueTokens(payload)` → `jwt.sign()`
3. `HttpResponseHandler.success(req, res, data)` sends the response

**External APIs Called**:

| Condition | External API | Method | URL | Purpose |
|---|---|---|---|---|
| `app_name === 'retailerApp'` | RMS (via sarvm-utility) | POST/GET | Configured in sarvm-utility | Fetches all shops owned by the user. Returns shop_id, onboarding flags (KYC, subscription, GST) |
| `app_name === 'logisticsDelivery'` | LMS | GET | `${INTERNAL_LOAD_BALANCER}/lms/apis/v1/profile/${userId}` | Fetches delivery data: onboarding status, subscription status |

---

#### 7.1.3 Generate Token (POST — Arbitrary Payload)

| Property | Value |
|---|---|
| **Method** | `POST` |
| **Path** | `/auth/apis/v1/token` |
| **Auth Required** | No explicit check |
| **Purpose** | Generates tokens from an arbitrary payload sent in the request body |
| **Use Case** | Internal service-to-service token generation |

**Request**:
```http
POST /auth/apis/v1/token HTTP/1.1
Host: localhost:3200
Content-Type: application/json

{
  "userId": "63300cb5ea6a3078062a23fc",
  "scope": ["Users", "retailerApp"],
  "phone": "9876543210"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "body": {}
  }
}
```

**Internal Logic**:
1. Route extracts the full request body as the payload
2. `controllers/v1/Auth.js` — `generateToken(payload)` directly calls `AuthService.issueToken(payload)`
3. No DB lookup, no external API calls — the payload is signed as-is
4. **Security note**: This endpoint does not validate the payload contents. It trusts the caller to provide a valid payload. It's intended for internal use only.

---

#### 7.1.4 Get Unauthenticated Token

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/auth/apis/v1/unauth_token` |
| **Auth Required** | No |
| **Purpose** | Issues a restricted anonymous token for pre-authentication flows |
| **Required Headers** | `app_name`, `app_version_code` |

**Request**:
```http
GET /auth/apis/v1/unauth_token HTTP/1.1
Host: localhost:3200
app_name: retailerApp
app_version_code: 101
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "body": {}
  }
}
```

**Internal Logic**:
1. `controllers/v1/Auth.js` — `getUnauthorizeToken(dataValues)`:
   - Creates payload: `{ userId: 'anonymous', scope: [app_name] }`
   - No DB query
   - No external API call
2. Calls `AuthService.issueToken(payload)` → `AuthManager.issueTokens(payload)`
3. The resulting token has:
   - `userId: 'anonymous'` (not a real user)
   - `scope: ['retailerApp']` (only the app name, no 'Users' scope)
4. Downstream services can check for `userId === 'anonymous'` to restrict access
5. The `requiresScopes` middleware would block this token from accessing routes that require `['Users']` scope

---

#### 7.1.5 Swagger API Documentation

| Property | Value |
|---|---|
| **Method** | `GET` |
| **Path** | `/auth/apis/apidocs` |
| **Auth Required** | No |
| **Purpose** | Interactive Swagger UI for API exploration |

Served via `swagger-ui-express` using the OpenAPI 3.0.3 spec at `src/openapi/openapi.json`.

The OpenAPI spec documents:
- Server URLs: `http://localhost:3200/` (local), `https://api.sarvm.ai/` (production), `https://uat-api.sarvm.ai/` (staging)
- Three schemas: `Token`, `Success`, `Error`
- Three paths: `/auth/apis/v1/token/{userId}`, `/auth/apis/v1/unauth_token`, `/auth/apis/healthcheck`

---

### 7.2 Internal API Integrations (Outbound Calls)

These are HTTP calls the auth service makes TO other microservices:

#### 7.2.1 Retailer Management Service (RMS)

| Property | Value |
|---|---|
| **Called From** | `controllers/v1/Auth.js` → `generateRetailerData()` |
| **Via** | `sarvm-utility` → `apiServices.rms.getAllShopViaUserId()` |
| **When** | `app_name === 'retailerApp'` AND `getToken()` endpoint is called |
| **Purpose** | Fetches the user's associated shop data to embed in the JWT token |

**What the call does**:
- Sends the user's `headers` (including `app_name`, `app_version_code`, `Authorization`) and `body` (containing `userId`) to the RMS service.
- The RMS service returns an array of shops owned by the user.
- The auth service uses the FIRST shop in the array (`shopApiResponse.data[0]`).
- Extracts: `shop_id`, `id` (unique shop ID), `isKYCVerified`, `isSubscribed`, `GST_no`.
- Constructs `shopMeta` with a `flag` object:
  - `onBoarding`: true only if BOTH `isKYCVerified` AND `isSubscribed` are true
  - `isSubscribed`: direct from shop data
  - `GST_no`: true if `GST_no` is not null
  - `isKYCVerified`: direct from shop data

**Why this data is in the JWT**: By embedding shop metadata in the token, the client can check onboarding status, subscription status, and KYC status without making a separate API call on every app launch. This reduces latency for the initial app load.

#### 7.2.2 Logistics Management Service (LMS)

| Property | Value |
|---|---|
| **Called From** | `services/v1/Logistic/index.js` → `logisticInformation()` |
| **Via** | Direct Axios call |
| **When** | `app_name === 'logisticsDelivery'` AND `getToken()` endpoint is called |
| **URL** | `GET ${INTERNAL_LOAD_BALANCER}/lms/apis/v1/profile/${userId}` |
| **Purpose** | Fetches delivery person's onboarding and subscription status |

**What the call does**:
- Makes a direct `GET` request to the LMS service using Axios.
- The LMS service returns the delivery person's profile data.
- Extracts `deliveryData` object containing:
  - `onbording` (boolean): whether the delivery person has completed onboarding
  - `subscribed` (boolean): whether the delivery person has an active subscription
- These values are embedded in the JWT payload AND returned in the `body` field of the token response.

**Why direct Axios instead of sarvm-utility**: The RMS call uses the pre-built API client from sarvm-utility, but the LMS call uses raw Axios. This suggests the LMS integration was added later, after the sarvm-utility package was last updated. The LMS client hasn't been added to the shared utility yet.

### 7.3 Reverse Proxy Integration

All requests not matching `/auth/apis/*` are proxied to downstream services:

| Property | Value |
|---|---|
| **Proxy Library** | `http-proxy-middleware` v2.0.6 |
| **Target** | `INTERNAL_LOAD_BALANCER` env var |
| **Change Origin** | `true` (rewrites Host header to match target) |
| **WebSocket Support** | `true` |
| **Token Verification** | Required (via `AuthController.verifyToken()`) |

**Proxy Configuration** (from `server.js`):
```javascript
const options = {
  target: config.url.INTERNAL_LOAD_BALANCER,
  changeOrigin: true,
  ws: true,
};
```

**How it works**:
1. Request arrives at `app.all('*')`.
2. Middleware calls `AuthController.verifyToken(dataValues)` which extracts the JWT from the Authorization header and verifies it.
3. If verification passes → `next()` is called → `createProxyMiddleware(options)` forwards the request.
4. If verification fails → error is thrown → caught by Express error handler.

**Environment-specific targets**:
| Environment | INTERNAL_LOAD_BALANCER |
|---|---|
| Local | `http://localhost` |
| Development | `http://localhost` |
| Staging | `http://localhost` |
| Production | `http://localhost` (placeholder in `.prd.env`) |

In production, this would be the internal AWS load balancer URL (e.g., `http://internal-alb-1234567890.ap-south-1.elb.amazonaws.com`).

---

## 8. Database Design

### 8.1 Database Technology

| Property | Value |
|---|---|
| **Engine** | Amazon DocumentDB (MongoDB-compatible) |
| **Database Name** | `ums` (User Management System) |
| **ODM** | Mongoose v6.10.0 |
| **Connection** | Singleton pattern via custom `db` class |
| **Connection Options** | `useNewUrlParser: true`, `useUnifiedTopology: true`, `strictQuery: true` |
| **Connection Strings** | |
| — Local | `mongodb://localhost:27017/ums` |
| — Dev | `mongodb://sarvmdev:***@dev-db.cluster-c6vufvons2bc.ap-south-1.docdb.amazonaws.com/ums?retryWrites=false` |
| — Staging | `mongodb://sarvmUATRead:***@uat.cluster-c6vufvons2bc.ap-south-1.docdb.amazonaws.com/ums?retryWrites=false` |
| — Production | Placeholder (`[]`) |

**Note**: `retryWrites=false` is required for Amazon DocumentDB, which doesn't support retryable writes (a MongoDB 3.6+ feature). This is a key difference between DocumentDB and native MongoDB.

### 8.2 Connection Singleton Pattern

**File**: [src/apis/db/index.js](src/apis/db/index.js)

```javascript
class db {
  constructor() {
    if (!db.instance) {
      db.instance = this;
    }
    return db.instance;
  }

  connect() {
    mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });
    this.Users = UserModel;
  }

  static getInstance() {
    return this.instance;
  }
}
```

- **Why Singleton**: Ensures exactly one MongoDB connection pool is maintained throughout the application lifecycle. Multiple connections would waste resources and could hit DocumentDB connection limits.
- **Usage**: `new DB()` in `InitApp` creates the instance; `db.getInstance()` in controllers retrieves it.
- **Model Attachment**: After connecting, the `Users` model is attached to the instance as `this.Users`, making it accessible via `db.getInstance().Users`.

### 8.3 User Schema (Mongoose Model)

**File**: [src/apis/models/Users.js](src/apis/models/Users.js)  
**Collection**: `users` (Mongoose auto-pluralizes)

```javascript
const UserSchema = new mongoose.Schema({
  username: { type: String },
  phone: { type: String, required: true, unique: true },
  refreshTokenTimestamp: { type: Number, required: true, default: Math.round(new Date().getTime() / 1000) },
  basicInformation: {
    personalDetails: {
      firstName: String,
      lastName: String,
      FathersName: String,
      DOB: Date,
      Gender: String,
      secondaryMobileNumber: String,
      emailID: String,
    },
    kycDetails: { kycId: String },
    transactionDetails: { transactionDetailsId: String },
  },
  retailerData: {},
  deliveryData: {},
  householdData: {},
});
```

#### 8.3.1 Field-by-Field Breakdown

| Field | Type | Required | Unique | Default | Purpose |
|---|---|---|---|---|---|
| `username` | String | No | No | — | Display name of the user |
| `phone` | String | Yes | Yes | — | Primary identifier. Phone number is the login credential for all Sarvm apps. Unique index ensures no duplicate registrations. |
| `refreshTokenTimestamp` | Number | Yes | No | `Math.round(Date.now() / 1000)` | Unix timestamp (seconds) used for refresh token invalidation. When a user logs out or a token is revoked, this timestamp is updated. Any refresh token issued before this timestamp is considered invalid. |
| `basicInformation.personalDetails` | Object | No | No | — | Nested document with personal info: firstName, lastName, FathersName, DOB, Gender, secondaryMobileNumber, emailID |
| `basicInformation.kycDetails` | Object | No | No | — | KYC (Know Your Customer) verification reference |
| `basicInformation.transactionDetails` | Object | No | No | — | Transaction history reference |
| `retailerData` | Object | No | No | — | Flexible schema-less field for retailer-specific data. Currently empty schema (accepts any structure). |
| `deliveryData` | Object | No | No | — | Flexible schema-less field for delivery person data |
| `householdData` | Object | No | No | — | Flexible schema-less field for household/consumer data |

#### 8.3.2 Additional Fields Referenced in Code But Not in Schema

The controller code references fields that must exist in the actual database documents but are not explicitly defined in the Mongoose schema:

| Field | Referenced In | Purpose |
|---|---|---|
| `userType` | `getToken()`, `getUserType()`, `getSegment()` | User classification (e.g., 'EMPLOYEE_SH', 'EMPLOYEE_SSO', 'EMPLOYEE_CO', 'HOUSEHOLD') |
| `flyyUserId` | `getToken()` | Flyy gamification platform user ID |
| `adminData.status` | `generateAdminData()`, `getSegment()` | Admin account status ('active' or 'inactive') |
| `adminData.role` | `generateAdminData()`, `getSegment()` | Admin role (e.g., 'super_admin') |

These fields likely exist in the database (populated by the `user_mgmt_service`) but are accessible in Mongoose because `retailerData`, `deliveryData`, `householdData` are schema-less objects, and Mongoose allows access to document fields not in the schema via `.toObject()` and `._doc`.

### 8.4 Database Operations in Auth Service

The auth service performs **read-only** database operations:

| Operation | Method | Query | Result |
|---|---|---|---|
| Find user by ID | `Users.findById(userId)` | `{ _id: ObjectId(userId) }` | Single user document or null |

**No writes are performed** by the auth service. User creation, updating profiles, and other write operations are handled by the `user_mgmt_service`. The auth service only reads user data to construct JWT payloads.

### 8.5 Legacy SQL Infrastructure

The codebase contains remnants of a SQL-based architecture:

- **Knex.js** configuration (commented out in `config/index.js`):
  ```javascript
  // db: {
  //   client: 'mongodb',
  //   connection: { host: DB_HOST, user: DB_USER, port: DB_PORT, password: DB_PASSWORD, database: 'UserDB' },
  //   pool: { min: 2, max: 10 },
  //   migrations: { directory: './knex/migrations', tableName: 'knex_migrations' },
  // },
  ```
- **Migration scripts** in `src/scripts/` (migrateLatest.js, migrateMake.js, migrateRollback.js) reference `../knex/knex` which doesn't exist.
- **mysql** and **objection.js** dependencies in `package.json`.

This suggests the service was originally planned to use MySQL (possibly for the auth tables) but migrated to MongoDB/DocumentDB as the primary store.

---

## 9. Setup & Installation

### 9.1 Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | 17.x or 18.x | Runtime |
| npm | 8.x+ | Package manager |
| MongoDB | 4.x+ (or compatible DocumentDB) | Database |
| Git | 2.x+ | Version control & sarvm-utility dependency |
| AWS CodeCommit credentials | — | Required to install `sarvm-utility` from private repo |

### 9.2 Environment Variables

Create a `.env` file or use one of the existing environment files:

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Environment mode (development/production/test) |
| `ENV` | Yes | `dev` | Environment identifier |
| `BUILD_NUMBER` | Yes | `101` | Build version number |
| `HOST` | Yes | `localhost` | Server hostname |
| `HOST_PORT` | Yes | `3200` | Server port |
| `HOST_SERVICE_NAME` | Yes | `auth` | Service name (used to construct pathPrefix: `/${HOST_SERVICE_NAME}/apis`) |
| `MONGO_URL` | Yes | — | Full MongoDB connection string |
| `HS256_TOKEN_SECRET` | Yes | `sarvm` | JWT signing secret (HS256) |
| `ACCESS_TOKEN_EXPIRESIN` | Yes | `365d` | Access token TTL |
| `REFRESH_TOKEN_EXPIRESIN` | Yes | `365d` | Refresh token TTL |
| `INTERNAL_LOAD_BALANCER` | Yes | `http://localhost` | URL of the internal load balancer for proxying |
| `LOAD_BALANCER` | No | `http://localhost` | Public load balancer URL |
| `PINO_LOG_LEVEL` | No | `info` | Pino logger level |
| `PINO_LOGGER_TRANSPORT_TYPE` | No | — | Logger transport (e.g., `pino-pretty` for dev) |
| `PINO_LOGGER_DESTINATION` | No | — | Log output file path (e.g., `./logs/logs.log`) |
| `SESSION_NAME` | No | `logger_session` | CLS-hooked namespace name |

### 9.3 Installation Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd backend/auth_service

# 2. Install dependencies (requires AWS CodeCommit git credentials for sarvm-utility)
npm install

# 3. Choose an environment to run:

# Local development (with local MongoDB)
npm run lcl

# Local with dev database
npm run lcl:dev

# Local with staging database
npm run lcl:stg

# Local with production database
npm run lcl:prd

# Production mode
npm run prd

# Staging mode
npm run stg
```

### 9.4 NPM Run Scripts

| Script | Command | Description |
|---|---|---|
| `lcl` | `nodemon -r dotenv/config ./server dotenv_config_path=./.lcl.env` | Local MongoDB, auto-reload |
| `lcl:dev` | `nodemon -r dotenv/config ./server dotenv_config_path=./.dev.env` | Dev DocumentDB, auto-reload |
| `lcl:stg` | `nodemon -r dotenv/config ./server dotenv_config_path=./.stg.env` | Staging DocumentDB, auto-reload |
| `lcl:prd` | `nodemon -r dotenv/config ./server dotenv_config_path=./.prd.env` | Production DocumentDB, auto-reload |
| `prd` | `nodemon ./server` | Production (env vars from OS) |
| `stg` | `nodemon ./server` | Staging (env vars from OS) |
| `test` | `NODE_ENV=test mocha ./unitTests/ --recursive` | Run unit tests |
| `mdb-latest-dev` | `node -r dotenv/config ./src/scripts/migrateLatest.js ...` | Run latest Knex migration |
| `mdb-make-lcl` | `node -r dotenv/config ./src/scripts/MigrateMake.js ...` | Create new Knex migration |
| `mdb-rollback-dev` | `node -r dotenv/config ./src/scripts/migrateRollback.js ...` | Rollback Knex migration |

### 9.5 Docker Setup

#### Production Build:
```dockerfile
FROM node:18.20.5 AS build          # Stage 1: Full Node for npm install
WORKDIR /usr/src/app
COPY ./package.json ./package-lock.json ./server.js ./
RUN npm ci --production --no-audit   # Install only production dependencies

FROM node:18.20.5-alpine             # Stage 2: Alpine for minimal image
WORKDIR /usr/src/app
COPY --from=build /usr/src/app ./
COPY src ./src
EXPOSE 3200
CMD ["sh", "-c", "NODE_ENV=production npm run-script stg"]
```

#### Dev/Staging Build:
```dockerfile
FROM 326457620362.dkr.ecr.ap-south-1.amazonaws.com/node:17.9.1 AS build
# Uses private ECR-hosted Node image
RUN npm ci --no-audit                # Includes devDependencies
CMD ["sh", "-c", "NODE_ENV=development npm run-script stg"]
```

**Key differences**:
- Production uses public `node:18.20.5` + `--production` flag (no devDependencies).
- Dev/Staging uses private ECR `node:17.9.1` + includes all dependencies.
- All Dockerfiles expose port **3200**.
- All use a log volume at `/usr/src/logs`.

### 9.6 Verification After Setup

Once the service is running, verify with:

```bash
# Health check
curl http://localhost:3200/auth/apis/healthcheck \
  -H "app_name: retailerApp" \
  -H "app_version_code: 101"

# Expected response:
# { "success": true, "data": { "ts": "...", "buildNumber": "101" } }

# Get unauthenticated token
curl http://localhost:3200/auth/apis/v1/unauth_token \
  -H "app_name: retailerApp" \
  -H "app_version_code: 101"

# Expected response:
# { "success": true, "data": { "accessToken": "...", "refreshToken": "...", "body": {} } }

# Swagger docs
# Open in browser: http://localhost:3200/auth/apis/apidocs
```

---

## 10. User Flow

### 10.1 First-Time User (Pre-Login)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User opens the app for the first time                        │
│                                                                  │
│ 2. App calls GET /auth/apis/v1/unauth_token                    │
│    Headers: { app_name: "retailerApp", app_version_code: 101 }  │
│                                                                  │
│ 3. Auth service generates anonymous JWT:                         │
│    payload = { userId: "anonymous", scope: ["retailerApp"] }     │
│                                                                  │
│ 4. App stores the anonymous token locally                        │
│                                                                  │
│ 5. App uses this token for pre-auth API calls:                   │
│    - Send OTP (via user_mgmt_service, proxied through auth)     │
│    - Verify OTP (via user_mgmt_service, proxied through auth)   │
│    The anonymous token has limited scope, so only pre-auth       │
│    endpoints are accessible.                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 Login Flow (OTP Verification → Token Generation)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User enters phone number                                     │
│                                                                  │
│ 2. App calls send OTP endpoint (via other service)              │
│    - Uses anonymous token for authorization                      │
│    - Request proxied through auth service                        │
│                                                                  │
│ 3. User receives OTP on phone                                   │
│                                                                  │
│ 4. User enters OTP in app                                        │
│                                                                  │
│ 5. App calls verify OTP endpoint (via user_mgmt_service)        │
│    - OTP verified successfully                                   │
│    - user_mgmt_service returns userId                            │
│                                                                  │
│ 6. App calls GET /auth/apis/v1/token/:userId                    │
│    Headers: { app_name, app_version_code, authorization }        │
│                                                                  │
│ 7. Auth service:                                                 │
│    a. Finds user in MongoDB by userId                            │
│    b. Calls RMS/LMS if needed (based on app_name)               │
│    c. Constructs payload with user data, shop data, flags        │
│    d. Signs JWT with HS256                                       │
│    e. Returns { accessToken, refreshToken }                      │
│                                                                  │
│ 8. App stores authenticated tokens                               │
│    - Uses accessToken for all subsequent API calls               │
│    - Stores refreshToken for token renewal                       │
│                                                                  │
│ 9. App reads token payload (client-side JWT decode)              │
│    - Determines onboarding status from shopMeta.flag             │
│    - Shows appropriate screen (onboarding wizard or dashboard)   │
└─────────────────────────────────────────────────────────────────┘
```

### 10.3 Authenticated User Making API Calls

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User performs action in app (e.g., view products)             │
│                                                                  │
│ 2. App makes API call:                                           │
│    GET /catalogue/apis/v1/products                               │
│    Authorization: accessToken eyJhbGci...                        │
│                                                                  │
│ 3. Auth service (server.js middleware pipeline):                  │
│    a. decodeAuthToken — verifies JWT, attaches to req.authPayload│
│    b. No match for /auth/apis/* routes                           │
│    c. Hits app.all('*') catch-all                                │
│    d. AuthController.verifyToken() — re-verifies the JWT         │
│    e. Verification passes → next()                               │
│    f. createProxyMiddleware forwards request to                   │
│       INTERNAL_LOAD_BALANCER/catalogue/apis/v1/products          │
│                                                                  │
│ 4. Catalogue service processes request and responds               │
│                                                                  │
│ 5. Response proxied back through auth service to client           │
└─────────────────────────────────────────────────────────────────┘
```

### 10.4 Token Expired Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User makes API call with expired access token                 │
│                                                                  │
│ 2. Auth service middleware:                                      │
│    decodeAuthToken detects expired JWT                            │
│    → Throws ACCESSTOKEN_EXP_ERROR                                │
│                                                                  │
│ 3. Error handler returns:                                        │
│    { success: false, error: { code: "ACCESSTOKEN_EXP_ERROR",    │
│      message: "Access Token expired" } }                         │
│    HTTP Status: 200 (not 401!)                                   │
│                                                                  │
│ 4. Client detects ACCESSTOKEN_EXP_ERROR in response              │
│    → Uses refresh token to request new tokens:                   │
│    GET /auth/apis/v1/token/:userId                               │
│    Authorization: refreshToken eyJhbGci...                       │
│                                                                  │
│ 5. If refresh token is valid → new tokens issued                 │
│    If refresh token is also expired → REFRESHTOKEN_EXP_ERROR     │
│    → Client must re-authenticate (back to OTP flow)              │
└─────────────────────────────────────────────────────────────────┘
```

### 10.5 Admin User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Admin logs in via admin app                                   │
│    app_name: "admin"                                             │
│                                                                  │
│ 2. After OTP verification, calls GET /auth/apis/v1/token/:userId│
│                                                                  │
│ 3. Auth service:                                                 │
│    a. Looks up user in MongoDB                                   │
│    b. Reads user.adminData: { status: "active", role: "super_admin" } │
│    c. getSegment → returns "super_admin" (from adminData.role)   │
│    d. getUserType → returns "ADMIN"                              │
│    e. Payload includes:                                          │
│       - adminData: { status, role }                              │
│       - scope: ['ADMIN'] (not ['Users', 'admin'])                │
│       - segmentId: 'super_admin'                                 │
│                                                                  │
│ 4. If adminData.status !== "active":                             │
│    - segmentId = "non-admin"                                     │
│    - Token still issued, but admin-specific endpoints can        │
│      check the segment to deny access                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Edge Cases & Limitations

### 11.1 Known Edge Cases

| # | Edge Case | Current Behavior | Impact |
|---|---|---|---|
| 1 | **User not found in DB** | Throws `INTERNAL_SERVER_ERROR` with message "user does not exists" | Returns 500 to client instead of a more specific 404. The error message has a typo ("exists" should be "exist"). |
| 2 | **No shop data for retailer user** | `shopMeta.flag` defaults to all `false`, `shopId` and `shopUniqueId` remain `null` | Token is still issued, but with null shop IDs. Client must handle this gracefully. |
| 3 | **Multiple shops for a user** | Only the FIRST shop (`shopApiResponse.data[0]`) is used | If a user owns multiple shops, only the first one's data is embedded in the token. |
| 4 | **LMS service unavailable** | `logisticInformation()` throws `INTERNAL_SERVER_ERROR` | Logistics users cannot get tokens if LMS is down. No fallback/retry mechanism. |
| 5 | **RMS service unavailable** | `getAllShopViaUserId()` fails | Retailer users cannot get tokens if RMS is down. No fallback/circuit breaker. |
| 6 | **Anonymous user accessing protected routes** | `requiresScopes(['Users'])` would block, but the catch-all proxy doesn't use `requiresScopes` — it only calls `verifyToken`. | Anonymous tokens CAN pass `verifyToken` (the token is valid). Downstream services must check `userId === 'anonymous'` themselves. |
| 7 | **Invalid app_name in getSegment()** | Throws `INTERNAL_SERVER_ERROR` | Any app_name other than retailerApp/householdApp/logisticsDelivery/admin causes a crash. |
| 8 | **flyyUserId for "admin" app** | `app_name.slice(0, -3)` on "admin" (5 chars) → "ad" | The Flyy user ID is `"ad-<flyyUserId>"` which may not be a valid Flyy identifier. |
| 9 | **JWT not-before period** | Tokens have `notBefore: '120ms'` | If a client uses a token within 120ms of issuance, verification will fail. This is usually fine but could cause issues in automated tests. |
| 10 | **Token expiry is 365 days** | Both access and refresh tokens expire in 1 year | Extremely long-lived tokens are a security risk. If a token is compromised, it's valid for an entire year. |

### 11.2 Structural Limitations

| # | Limitation | Description |
|---|---|---|
| 1 | **No token revocation** | There's no blacklist/revocation mechanism. The `refreshTokenTimestamp` field exists in the User schema but is never checked during token verification. Once issued, a token is valid until expiry. |
| 2 | **No rate limiting** | No rate limiting on any endpoint, including token generation. A malicious actor could flood the `/unauth_token` endpoint. |
| 3 | **Same secret for all environments** | `HS256_TOKEN_SECRET=sarvm` is the same across all environments (lcl, dev, stg, prd). A token generated in dev would be valid in production. |
| 4 | **Hardcoded HS256 algorithm** | Cannot be changed via configuration. There's no support for RS256 or other asymmetric algorithms. |
| 5 | **No request body parsing for JSON** | `express.json()` is commented out in both `server.js` and `InitApp`. Only `express.urlencoded()` is active. This means JSON POST bodies might not be parsed correctly unless handled by the proxy. |
| 6 | **Duplicate middleware** | CORS, urlencoded parsing, and `decodeAuthToken` are applied both in `InitApp` and `server.js`. This means they run twice per request. |
| 7 | **Validation schemas defined but not enforced** | Joi schemas exist in `Validation/Schemas.js` and the `handleRESTReq` accepts a `validationSchema` parameter, but no validation is actually performed (`handleRequest` receives it but doesn't use it). |
| 8 | **POST /token has no access control** | The `generateToken` endpoint signs any arbitrary payload without authentication or authorization checks. If exposed externally, anyone could mint tokens. |
| 9 | **Legacy code not cleaned up** | `authorization.js` contains hardcoded JWT secrets (`user_mgmt_jwt_secret_key`), mysql/knex/objection dependencies are unused, migration scripts reference non-existent Knex files. |
| 10 | **No HTTPS enforcement** | No TLS termination in the service itself. Relies on the external load balancer for HTTPS. |

---

## 12. Performance & Scalability

### 12.1 Current Performance Characteristics

| Aspect | Assessment | Details |
|---|---|---|
| **Request Latency** | Low for auth-only routes | Token verification is CPU-bound (JWT verify) but takes <1ms. Token generation involves a DB read (~5-20ms) and potentially 1-2 external API calls (~50-200ms for RMS/LMS). |
| **Throughput** | Limited by external API calls | For `retailerApp` and `logisticsDelivery` token generation, the service makes synchronous HTTP calls to RMS/LMS, which are blocking. |
| **Memory** | Low | The service holds minimal state. The DB connection singleton and CLS session namespace are the only persistent in-memory objects. |
| **CPU** | Low to moderate | JWT signing/verification uses HMAC-SHA256 which is computationally inexpensive compared to RSA. |
| **Proxy Performance** | Good | `http-proxy-middleware` is stream-based and doesn't buffer the full request/response body. Requests are forwarded as they stream in. |

### 12.2 Bottlenecks

1. **External Service Dependencies**: Token generation for `retailerApp` requires a synchronous call to RMS (`getAllShopViaUserId`). If RMS is slow, every retailer login is slow. Same for LMS and logistics users.

2. **Single-threaded Node.js**: The service runs in a single Node.js process. While async I/O is efficient, CPU-intensive operations (like processing many concurrent JWT signs) could become a bottleneck under extreme load.

3. **MongoDB Connection Pool**: Not explicitly configured (Mongoose defaults: min 0, max 100). Under high load, connection pool exhaustion could occur.

4. **No Caching**: User data is fetched from MongoDB on every token generation. Frequently-accessed users could benefit from an in-memory cache (Redis/Node cache).

### 12.3 Scalability Recommendations

| Strategy | Implementation | Benefit |
|---|---|---|
| **Horizontal Scaling** | Run multiple Docker containers behind the load balancer | Since the service is stateless (DB is external, CLS sessions are request-scoped), it scales horizontally trivially. |
| **Redis Cache for User Data** | Cache `Users.findById()` results with a TTL | Reduces MongoDB load for frequently-accessed users (e.g., retailers logging in daily). |
| **Circuit Breaker for RMS/LMS** | Wrap external API calls in a circuit breaker (e.g., `opossum`) | Prevents cascading failures when RMS/LMS are down. Fall back to generating tokens without shop/logistics data. |
| **Connection Pool Tuning** | Configure Mongoose connection pool: `{ maxPoolSize: 50, minPoolSize: 5 }` | Prevents connection exhaustion under load while maintaining warm connections. |
| **Node.js Clustering** | Use `cluster` module or PM2 to spawn worker processes | Utilizes multiple CPU cores. Each worker handles a fraction of requests. |
| **Async External Calls** | Parallelize RMS/LMS calls with `Promise.all()` when possible | Currently sequential in the flow, but if more external calls are added in the future, parallelization would help. |

---

## 13. Future Improvements

### 13.1 Security Improvements

| # | Improvement | Priority | Rationale |
|---|---|---|---|
| 1 | **Rotate JWT Secret Per Environment** | Critical | Currently `sarvm` is used across all environments. A separate, strong secret per environment (dev/stg/prd) prevents cross-environment token reuse. |
| 2 | **Implement Token Revocation** | High | Use `refreshTokenTimestamp` in the User schema during verification. If the token's `iat` (issued at) is before the user's `refreshTokenTimestamp`, reject it. Enables logout and force-reauth. |
| 3 | **Shorten Token Expiry** | High | 365-day access tokens are a significant risk. Recommended: access token 15-60 minutes, refresh token 7-30 days. |
| 4 | **Add Rate Limiting** | High | Use `express-rate-limit` on token generation endpoints. Prevents brute-force attacks and DoS. |
| 5 | **Secure POST /token** | High | Add authentication/scope checks to the `POST /auth/apis/v1/token` endpoint. Currently, it can be called without any auth to sign arbitrary payloads. |
| 6 | **Helmet.js for HTTP Headers** | Medium | Add `helmet` middleware for security headers (XSS protection, content type sniffing, etc.). |
| 7 | **Migrate to RS256** | Low | Asymmetric JWT signing would allow downstream services to verify tokens with a public key without knowing the secret. |

### 13.2 Code Quality Improvements

| # | Improvement | Priority | Rationale |
|---|---|---|---|
| 1 | **Enable express.json() middleware** | High | Currently commented out. Required for proper JSON body parsing on POST endpoints. |
| 2 | **Remove duplicate middleware** | Medium | CORS, urlencoded, and decodeAuthToken are applied twice (InitApp + server.js). Remove one set. |
| 3 | **Clean up legacy SQL code** | Medium | Remove unused knex, mysql, objection dependencies and migration scripts. |
| 4 | **Implement Joi validation** | Medium | The validation infrastructure exists (schemas, middleware) but is never used. Wire it into the route handlers. |
| 5 | **Remove authorization.js** | Low | Legacy file with hardcoded secrets. Dead code that could confuse new developers. |
| 6 | **Fix flyyUserId for admin/logistics** | Low | `slice(0, -3)` produces incorrect prefixes for some app names. |
| 7 | **Add TypeScript** | Low | Type safety would prevent many of the edge cases currently present (e.g., accessing undefined properties). |

### 13.3 Operational Improvements

| # | Improvement | Priority | Rationale |
|---|---|---|---|
| 1 | **Health check should verify DB connection** | High | Current healthcheck only returns timestamp and build number. It should verify MongoDB connectivity. |
| 2 | **Add circuit breakers to external calls** | High | RMS/LMS failures should degrade gracefully, not crash token generation. |
| 3 | **Implement distributed tracing** | Medium | The CLS-hooked sessionId provides per-request context, but there's no integration with a distributed tracing system (e.g., AWS X-Ray, Datadog APM). |
| 4 | **Structured error logging** | Medium | Some errors are logged with inconsistent formats. Standardize to JSON-structured logs. |
| 5 | **Containerized unit tests** | Low | The `test` script exists but the `unitTests/` directory is not present. Add comprehensive unit tests for all controller methods. |

---

## 14. Summary

### 14.1 What the Auth Service Does

The Auth Service is the **central authentication gateway** for the Sarvm platform. It performs three critical functions:

1. **Token Issuance**: Generates HS256-signed JWTs containing user-specific data (userId, phone, userType, shopId, onboarding flags) for authenticated users, and anonymous tokens for pre-login flows.

2. **Token Verification**: Validates JWTs on every incoming request via middleware (`decodeAuthToken`) and the proxy catch-all (`verifyToken`). Invalid/expired tokens trigger typed errors (ACCESSTOKEN_EXP_ERROR, REFRESHTOKEN_EXP_ERROR).

3. **API Gateway / Reverse Proxy**: Forwards authenticated requests to downstream microservices (retailer_service, order_service, catalogue_mgmt_service, user_mgmt_service) via an internal load balancer using `http-proxy-middleware`.

### 14.2 Technology Choices Summary

| Choice | Rationale |
|---|---|
| **Node.js + Express** | Non-blocking I/O for efficient proxying; Express middleware pipeline for layered auth. |
| **JWT (HS256)** | Stateless authentication — no session store needed. HS256 is fast and sufficient for single-party verification. |
| **MongoDB (DocumentDB)** | Schema-flexible user documents; AWS-managed. |
| **http-proxy-middleware** | Proven library for Node.js reverse proxy with WebSocket support. |
| **sarvm-utility** | Shared code (Logger, ErrorHandler, AuthManager, apiServices) across all 5 backend services. |
| **Docker (multi-stage)** | Minimal production images (~150MB Alpine-based). |
| **Singleton DB** | Single connection pool per instance. |
| **CLS-Hooked** | Request-scoped context without parameter drilling. |

### 14.3 Service Interaction Map

```
                    ┌─────────────────┐
                    │   Auth Service    │
                    │    (Port 3200)    │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────┐ ┌───────────────┐ ┌─────────────────────┐
    │   MongoDB    │ │  RMS (Shops)  │ │  LMS (Logistics)    │
    │  (Read Only) │ │  (HTTP GET)   │ │  (HTTP GET)         │
    │  via Mongoose│ │  via sarvm-   │ │  via Axios           │
    │              │ │  utility      │ │  /lms/apis/v1/       │
    └─────────────┘ └───────────────┘ │  profile/:userId     │
                                       └─────────────────────┘
              Proxies to:
    ┌─────────────────────────────────────────┐
    │         INTERNAL LOAD BALANCER           │
    │                                          │
    │  retailer_service   order_service        │
    │  user_mgmt_service  catalogue_mgmt_svc   │
    └─────────────────────────────────────────┘
```

### 14.4 Key Files Quick Reference

| Purpose | File |
|---|---|
| Entry point | `server.js` |
| App initialization & DB connect | `src/InitApp/index.js` |
| Configuration | `src/config/index.js` |
| Route definitions | `src/apis/routes/v1/Auth.js` |
| Business logic | `src/apis/controllers/v1/Auth.js` |
| JWT operations | `src/common/libs/AuthManager/index.js` |
| Service layer | `src/apis/services/v1/Auth.js` |
| User model | `src/apis/models/Users.js` |
| DB connection | `src/apis/db/index.js` |
| Error constants | `src/constants/errorConstants/` |
| OpenAPI spec | `src/openapi/openapi.json` |
| Logistics integration | `src/apis/services/v1/Logistic/index.js` |

---

*Documentation generated from complete source code analysis of every file in the auth_service directory.*
