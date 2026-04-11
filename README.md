# Sarvm Auth Service — Complete Architecture & Workflow Documentation

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

The **Auth Service** is the centralized authentication and authorization gateway for the entire Sarvm ecosystem. It serves as the **single entry point** (API Gateway) for all client applications — Retailer App, Household App, Logistics Delivery App, and the Admin Panel.

### 1.2 Why does it exist?

- **Centralized Authentication**: Instead of every microservice implementing its own auth logic, the auth_service handles JWT token generation, verification, and decoding in a single place.
- **API Gateway / Reverse Proxy**: It does not just authenticate — it also **proxies** all authenticated requests forward to downstream microservices (Retailer Service, Order Service, Catalogue Service, User Management Service, Logistics Service) via an internal load balancer. This means every request from the frontend hits the auth_service first, gets validated, and then is forwarded to the appropriate backend service.
- **Multi-App Support**: The service is app-aware. The JWT payload is dynamically constructed based on which application is requesting the token (`retailerApp`, `householdApp`, `logisticsDelivery`, `admin`), embedding app-specific metadata (shop details for retailers, onboarding status for logistics, admin roles, etc.).

### 1.3 What does it do at a high level?

1. **Issues JWT tokens** (access + refresh) when a user is authenticated (after OTP verification by another service).
2. **Issues anonymous tokens** for unauthenticated access (guest browsing).
3. **Verifies JWT tokens** on every incoming request before proxying it downstream.
4. **Decodes JWT tokens** as Express middleware, attaching the decoded payload to `req.authPayload` for downstream consumption.
5. **Proxies requests** to internal microservices via `http-proxy-middleware`.
6. **Enriches token payloads** with cross-service data (e.g., calls the Retailer Management Service to get shop data, or the Logistics Management Service for delivery profile data).

### 1.4 Where does it sit in the ecosystem?

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────────────────┐
│  Client Apps │──────▶│   Auth Service   │──────▶│  Internal Microservices  │
│  (Mobile/Web)│       │  (API Gateway)   │       │  (rms, oms, cms, ums,    │
│              │       │  Port 3200       │       │   lms)                   │
└──────────────┘       └──────────────────┘       └──────────────────────────┘
```

Every frontend request goes through the Auth Service. It is the **gatekeeper**.

---

## 2. System Architecture

### 2.1 High-Level Architecture Diagram

```mermaid
graph TB
    subgraph "Client Applications"
        RA["Retailer App (Mobile)"]
        HA["Household App (Mobile)"]
        LD["Logistics Delivery App"]
        AD["Admin Panel (Web)"]
    end

    subgraph "Auth Service (Port 3200)"
        MW["Middleware Layer"]
        RT["Router Layer"]
        CT["Controller Layer"]
        SV["Service Layer"]
        AM["AuthManager (JWT Engine)"]
        DB_CONN["MongoDB Connection (Singleton)"]
    end

    subgraph "Internal Microservices (via Load Balancer)"
        RMS["Retailer Mgmt Service (rms)"]
        UMS["User Mgmt Service (ums)"]
        OMS["Order Service (oms)"]
        CMS["Catalogue Mgmt Service (cms)"]
        LMS["Logistics Mgmt Service (lms)"]
    end

    subgraph "Data Store"
        MONGO["MongoDB / AWS DocumentDB"]
    end

    RA -->|HTTPS| MW
    HA -->|HTTPS| MW
    LD -->|HTTPS| MW
    AD -->|HTTPS| MW

    MW -->|"Decode JWT (AuthManager.decodeAuthToken)"| RT
    RT -->|"/auth/apis/v1/*"| CT
    RT -->|"Catch-all '*' proxy"| SV
    CT --> SV
    SV --> AM
    AM -->|"jwt.sign / jwt.verify"| SV
    CT -->|"User lookup"| DB_CONN
    DB_CONN --> MONGO

    CT -->|"GET shop data"| RMS
    CT -->|"GET delivery profile"| LMS

    MW -->|"Proxy (http-proxy-middleware)"| RMS
    MW -->|"Proxy"| UMS
    MW -->|"Proxy"| OMS
    MW -->|"Proxy"| CMS
    MW -->|"Proxy"| LMS
```

### 2.2 Architectural Role Breakdown

| Role | What | Why |
|------|------|-----|
| **API Gateway** | All external traffic enters through Auth Service | Single point for auth enforcement; downstream services trust the gateway |
| **Token Issuer** | Generates access + refresh JWT tokens | Clients need tokens to access protected resources |
| **Token Verifier** | Validates JWT on every proxied request | Ensures only authenticated users reach backend services |
| **Token Decoder** | Decodes JWT and attaches payload to `req.authPayload` | Downstream code (routes, controllers) can read user identity without re-decoding |
| **Reverse Proxy** | Forwards authenticated requests to internal services | Clients don't need to know individual service URLs; load balancing is centralized |
| **Data Enricher** | Fetches shop/logistic data during token generation | JWT payload must contain role-specific metadata for the frontend |

### 2.3 Layered Architecture

The auth_service follows a **strict layered architecture** modeled from the MVC pattern:

```
┌─────────────────────────────────────────────┐
│                  server.js                  │  ← Entry Point & Express App Setup
├─────────────────────────────────────────────┤
│                 InitApp/                    │  ← Bootstrap: DB connect, session, middleware
├─────────────────────────────────────────────┤
│               routes/ (Router Layer)        │  ← URL → Controller mapping
├─────────────────────────────────────────────┤
│            controllers/ (Controller Layer)  │  ← Business logic orchestration
├─────────────────────────────────────────────┤
│             services/ (Service Layer)       │  ← JWT operations (sign/verify)
├─────────────────────────────────────────────┤
│               models/ (Data Layer)          │  ← Mongoose schemas
├─────────────────────────────────────────────┤
│                  db/ (DB Layer)             │  ← Singleton MongoDB connection
├─────────────────────────────────────────────┤
│              common/libs/ (Shared Libs)     │  ← AuthManager, ErrorHandler, etc.
└─────────────────────────────────────────────┘
```

---

## 3. Data Flow

### 3.1 Token Generation Flow (Authenticated User — Retailer App)

This is the most complex flow. It is triggered after OTP verification when the frontend calls `GET /auth/apis/v1/token/:userId`.

```mermaid
sequenceDiagram
    participant Client as Retailer App
    participant MW as Auth Middleware
    participant Router as Express Router
    participant Ctrl as AuthController
    participant Svc as AuthService
    participant AM as AuthManager
    participant DB as MongoDB (Users)
    participant RMS as Retailer Mgmt Service

    Client->>MW: GET /auth/apis/v1/token/:userId<br/>Headers: app_name, app_version_code, Authorization
    MW->>MW: AuthManager.decodeAuthToken()<br/>Decode existing JWT (if any) → req.authPayload
    MW->>MW: ReqLogger (log the request)
    MW->>Router: Route to /auth/apis/v1/token/:userId

    Router->>Router: handleRESTReq() extracts headers, params, body, query
    Router->>Ctrl: AuthController.getToken(dataValues)

    Ctrl->>DB: Users.findById(userId)
    DB-->>Ctrl: User document (phone, userType, flyyUserId, ...)

    alt User not found
        Ctrl-->>Client: 500 INTERNAL_SERVER_ERROR "user does not exists"
    end

    Ctrl->>RMS: apiServices.rms.getAllShopViaUserId({headers, body})<br/>via sarvm-utility
    RMS-->>Ctrl: Shop data (shop_id, id, isKYCVerified, isSubscribed, GST_no)

    Ctrl->>Ctrl: generateRetailerData()<br/>Build JWT payload with:<br/>entityType, entityId, userId, phone,<br/>userType, shopId, shopUniqueId,<br/>isEmployee, shopMeta, segmentId,<br/>flyyUserId, scope

    Ctrl->>Svc: AuthService.issueToken(payload)
    Svc->>AM: AuthManager.issueTokens(payload)

    AM->>AM: jwt.sign(payload, secret, accessTokenOptions)<br/>→ accessToken
    AM->>AM: jwt.sign({userId, scope:[]}, secret, refreshTokenOptions)<br/>→ refreshToken

    AM-->>Svc: { accessToken, refreshToken, body: {} }
    Svc-->>Ctrl: Token result
    Ctrl-->>Router: Token result
    Router->>Client: 200 { success: true, data: { accessToken, refreshToken } }
```

#### Step-by-step breakdown:

1. **Client sends request**: `GET /auth/apis/v1/token/63300cb5ea6a3078062a23fc` with headers `app_name: retailerApp`, `app_version_code: 101`, and `Authorization: accessToken <existing-jwt>`.
2. **Why the Authorization header?**: The auth_service decodes any existing JWT to identify the user context. This header is also forwarded to inter-service calls (e.g., to RMS).
3. **Middleware `decodeAuthToken`**: Runs on every request. Splits the `Authorization` header into subject (`accessToken` / `refreshToken`) and the JWT string. Verifies with `jwt.verify()`. If valid, decoded payload is placed on `req.authPayload`. If no token or invalid, it calls `next()` (no blocking for this middleware).
4. **Route handler `handleRESTReq`**: Extracts `app_name`, `app_version_code`, `authorization` from `req.headers`. Merges `req.params` (`{ userId }`), `req.body`, `req.query`, and `req.authPayload` into a single `dataValues` object.
5. **Controller `getToken`**: Looks up the user in MongoDB by `userId`. If not found, throws `INTERNAL_SERVER_ERROR`.
6. **Cross-service call to RMS**: Calls `apiServices.rms.getAllShopViaUserId()` (provided by `sarvm-utility`) to fetch the shop linked to this user. This is an internal HTTP call to the Retailer Management Service.
7. **Why?** Because the JWT for `retailerApp` must contain `shopId`, `shopUniqueId`, `shopMeta` (onboarding flags, KYC status, subscription status, GST).
8. **Payload construction**: `generateRetailerData()` builds the JWT payload object with all the enriched data.
9. **Token signing**: `AuthManager.issueTokens()` signs the access token with the full payload, and a minimal refresh token (just `userId` and empty scope). Both use HS256 algorithm.
10. **Response**: Returns `{ accessToken, refreshToken }` to the client.

### 3.2 Token Generation Flow — Logistics Delivery App

```mermaid
sequenceDiagram
    participant Client as Logistics App
    participant Ctrl as AuthController
    participant LMS as Logistics Mgmt Service
    participant AM as AuthManager

    Client->>Ctrl: GET /auth/apis/v1/token/:userId<br/>app_name: logisticsDelivery

    Ctrl->>Ctrl: Users.findById(userId)
    Ctrl->>LMS: GET /lms/apis/v1/profile/:userId<br/>(via axios → INTERNAL_LOAD_BALANCER)
    LMS-->>Ctrl: { deliveryData: { onbording, subscribed } }

    Ctrl->>Ctrl: generateLogisticData()<br/>Build payload with entityType: 'LU',<br/>onbording, subscribed, etc.

    Ctrl->>AM: issueTokens(payload)
    Note right of AM: Special: if scope[1]==="logisticsDelivery",<br/>body includes {onbording, subscribed}
    AM-->>Client: { accessToken, refreshToken, body: {onbording, subscribed} }
```

**Why is deliveryData fetched?** The logistics app needs to know the driver's onboarding and subscription status immediately upon login, so this data is embedded in the token response body.

### 3.3 Token Generation Flow — Admin Panel

```mermaid
sequenceDiagram
    participant Client as Admin Panel
    participant Ctrl as AuthController
    participant AM as AuthManager

    Client->>Ctrl: GET /auth/apis/v1/token/:userId<br/>app_name: admin

    Ctrl->>Ctrl: Users.findById(userId)
    Ctrl->>Ctrl: generateAdminData()<br/>Reads user.adminData.status & role<br/>Payload includes: adminData: {status, role},<br/>scope: ['ADMIN']

    Ctrl->>AM: issueTokens(payload)
    AM-->>Client: { accessToken, refreshToken }
```

**Why scope `['ADMIN']`?** Admin users have a different scope array, distinguishing them from regular users. The `segmentId` for admin is derived from `user.adminData.role` if active, or `'non-admin'` otherwise.

### 3.4 Unauthenticated (Anonymous) Token Flow

```mermaid
sequenceDiagram
    participant Client as Any App
    participant Router as Express Router
    participant Ctrl as AuthController
    participant AM as AuthManager

    Client->>Router: GET /auth/apis/v1/unauth_token<br/>Headers: app_name, app_version_code
    Router->>Ctrl: getUnauthorizeToken(dataValues)

    Ctrl->>Ctrl: Build payload:<br/>{ userId: 'anonymous', scope: [app_name] }

    Ctrl->>AM: issueTokens(payload)
    AM-->>Client: { accessToken, refreshToken }
```

**Why anonymous tokens?** Before login (e.g., browsing a catalog, OTP request screen), the client needs a valid JWT to reach backend services. The anonymous token grants limited access with `userId: 'anonymous'`.

### 3.5 API Gateway / Proxy Flow (All Non-Auth Requests)

This is the most critical architectural pattern. **Any request that does NOT match `/auth/apis/*`** is treated as a proxy request.

```mermaid
sequenceDiagram
    participant Client as Client App
    participant MW as Auth Middleware
    participant Verifier as AuthController.verifyToken
    participant Proxy as http-proxy-middleware
    participant Backend as Internal Microservice

    Client->>MW: GET /rms/apis/v1/shop/list<br/>Authorization: accessToken <jwt>

    MW->>MW: AuthManager.decodeAuthToken()<br/>Decode JWT → req.authPayload

    Note over MW: Request does NOT match /auth/apis/*<br/>Falls through to catch-all app.all('*')

    MW->>Verifier: verifyToken({headers, path, body})
    Verifier->>Verifier: Extract JWT from Authorization header
    Verifier->>Verifier: AuthService.verifyToken(jwtToken)
    Verifier->>Verifier: AuthManager.verifyToken(token)<br/>jwt.verify(token, secret)

    alt Token Valid
        Verifier-->>MW: true
        MW->>Proxy: Forward request to INTERNAL_LOAD_BALANCER
        Proxy->>Backend: GET http://internal-lb/rms/apis/v1/shop/list
        Backend-->>Client: Response
    end

    alt Token Invalid / Expired
        Verifier-->>MW: INTERNAL_SERVER_ERROR
        MW-->>Client: 500 Error
    end
```

#### How the proxy works in `server.js`:

```javascript
// 1. WebSocket proxy for /whs path
app.use('/whs', createProxyMiddleware(options));

// 2. Catch-all: verify token, then proxy
app.all('*', 
  async (req, res, next) => {
    // Verify the JWT token
    await AuthController.verifyToken({ headers, path, body });
    next(); // Token valid → proceed to proxy
  },
  createProxyMiddleware(options) // Forward to INTERNAL_LOAD_BALANCER
);
```

**Why this architecture?**
- The auth_service acts as a **transparent reverse proxy**. The client doesn't need to know the internal service URLs.
- The `INTERNAL_LOAD_BALANCER` env variable points to an internal load balancer (e.g., AWS ALB/NLB) that routes `/rms/*` to the Retailer Service, `/oms/*` to Order Service, etc.
- WebSocket connections to `/whs` are proxied directly without token verification (likely for real-time warehouse/delivery updates).

### 3.6 Middleware Pipeline (Complete Request Lifecycle)

```
Request Arrives
       │
       ▼
┌─────────────────────────────────────┐
│ 1. InitApp Middleware               │
│    ├─ AuthManager.decodeAuthToken() │  ← Decode JWT, set req.authPayload
│    ├─ Session Namespace (cls-hooked)│  ← Set sessionId, clientIp
│    ├─ express.urlencoded()          │  ← Parse URL-encoded bodies
│    └─ cors()                        │  ← Enable CORS
│    └─ ReqLogger                     │  ← Log request
│    └─ MongoDB connect (Singleton)   │  ← One-time DB connection
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 2. server.js Middleware             │
│    ├─ express.urlencoded()          │  ← Parse URL-encoded (again)
│    ├─ cors()                        │  ← CORS (again)
│    ├─ AuthManager.decodeAuthToken() │  ← Decode JWT (again)
│    └─ ReqLogger                     │  ← Log request
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 3. Route Matching                   │
│    ├─ /auth/apis/healthcheck        │  → Health check response
│    ├─ /auth/apis/apidocs            │  → Swagger UI
│    ├─ /auth/apis/v1/token/:userId   │  → getToken()
│    ├─ /auth/apis/v1/token (POST)    │  → generateToken()
│    ├─ /auth/apis/v1/unauth_token    │  → getUnauthorizeToken()
│    ├─ /whs/*                        │  → Direct proxy (no auth check)
│    └─ * (catch-all)                 │  → verifyToken() → Proxy
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 4. Error Handling                   │
│    ├─ 404 PAGE_NOT_FOUND_ERROR      │  ← Unmatched routes
│    └─ Global Error Handler          │  ← BaseError → handleError()
│       └─ Non-BaseError → wrap in    │
│          INTERNAL_SERVER_ERROR       │
└─────────────────────────────────────┘
```

> **Note:** There is a duplication of middleware between `InitApp/index.js` and `server.js`. Both register `decodeAuthToken`, `cors()`, `urlencoded()`, and `ReqLogger`. This means these middleware run **twice** per request — once in InitApp and once in server.js. This is a known code smell (see [Section 11: Edge Cases & Limitations](#11-edge-cases--limitations)).

---

## 4. Tech Stack

### 4.1 Core Runtime & Framework

| Technology | Version | Why |
|-----------|---------|-----|
| **Node.js** | 18.20.5 (prod), 17.9.1 (dev/staging) | Server-side JavaScript runtime. Chosen for its non-blocking I/O model, ideal for a proxy/gateway service that is I/O-heavy. |
| **Express.js** | ^4.18.1 | De facto standard Node.js web framework. Provides routing, middleware pipeline, and request/response handling. |

### 4.2 Authentication & Security

| Technology | Version | Why |
|-----------|---------|-----|
| **jsonwebtoken (JWT)** | ^8.5.1 | Industry-standard for stateless authentication. Tokens are self-contained and can be verified without DB lookup. |
| **bcrypt** | ^5.0.1 | Password hashing (present in dependencies though not actively used in current auth flows — OTP-based auth bypasses password). |
| **cors** | ^2.8.5 | Cross-Origin Resource Sharing. Allows the frontend (different origin) to access the API. |

### 4.3 Database

| Technology | Version | Why |
|-----------|---------|-----|
| **Mongoose** | ^6.10.0 | ODM for MongoDB. Provides schema validation, model definition, and query building. |
| **MongoDB / AWS DocumentDB** | — | NoSQL document database. The `ums` (User Management) database stores user documents. DocumentDB is used in dev/staging/prod (AWS-managed MongoDB-compatible). |
| **Knex** | ^2.0.0 | SQL query builder (present in dependencies and migration scripts, but the active DB is MongoDB. This is a **legacy artifact** from when the service may have used MySQL). |
| **MySQL** | ^2.18.1 | MySQL driver (legacy dependency, not actively used). |
| **Objection.js** | ^3.0.1 | ORM for SQL databases (legacy, not actively used). |

### 4.4 Networking & Proxy

| Technology | Version | Why |
|-----------|---------|-----|
| **http-proxy-middleware** | ^2.0.6 | Reverse proxy middleware for Express. Forwards requests to the internal load balancer. Supports WebSocket proxying (`ws: true`). |
| **axios** | ^1.3.4 | HTTP client for inter-service communication (e.g., calling LMS for logistics profile). |
| **sarvm-utility** | v5.0.3 | Internal shared npm package (from AWS CodeCommit). Provides `Logger`, `ReqLogger`, `ErrorHandler`, `AuthManager`, `HttpResponseHandler`, `apiServices` (inter-service API wrappers like `rms.getAllShopViaUserId`). |

### 4.5 Utilities

| Technology | Version | Why |
|-----------|---------|-----|
| **dotenv** | ^16.0.1 | Loads environment variables from `.env` files for local development. |
| **module-alias** | ^2.2.2 | Enables path aliases (`@controllers`, `@services`, `@db`, etc.) for cleaner import statements. |
| **joi** | ^17.6.0 | Schema validation library (defined in Validation module but not actively wired into routes). |
| **morgan** | ^1.10.0 | HTTP request logger (present but commented out in favor of `ReqLogger` from sarvm-utility). |
| **cuid** | ^3.0.0 | Collision-resistant unique ID generator. Used for session IDs. |
| **moment** | ^2.29.3 | Date manipulation library (dependency present, likely used in sarvm-utility). |
| **uuid** | ^8.3.2 | UUID generator (dependency present). |
| **swagger-ui-express** | ^4.6.0 | Serves the OpenAPI/Swagger documentation UI at `/auth/apis/apidocs`. |

### 4.6 DevOps & Containerization

| Technology | Why |
|-----------|-----|
| **Docker** | Multi-stage builds for optimized images. Production uses `node:18.20.5-alpine`. Dev/Staging use private ECR images with `node:17.9.1`. |
| **AWS ECR** | Private Docker image registry (`326457620362.dkr.ecr.ap-south-1.amazonaws.com`). |
| **AWS DocumentDB** | MongoDB-compatible managed database service (ap-south-1 region). |
| **AWS CodeCommit** | Hosts the `sarvm-utility` shared package. |
| **Nodemon** | Auto-restarts the server on file changes during development. |

### 4.7 Code Quality

| Tool | Why |
|------|-----|
| **ESLint** (airbnb-base + prettier) | Enforces consistent code style and catches errors. |
| **Prettier** | Auto-formats code (120 char width, single quotes, trailing commas). |

---

## 5. Project Structure

```
auth_service/
├── .dev.env                          # Dev environment variables (DocumentDB dev cluster)
├── .stg.env                          # Staging environment variables (DocumentDB UAT cluster)
├── .prd.env                          # Production environment variables (DocumentDB prod)
├── .lcl.env                          # Local environment variables (localhost MongoDB)
├── .env.example                      # Template for environment setup
├── .dockerignore                     # Docker build exclusions
├── .eslintrc.json                    # ESLint configuration (airbnb-base + prettier)
├── .eslintignore                     # ESLint ignore patterns
├── .prettierrc                       # Prettier configuration
├── .prettierignore                   # Prettier ignore patterns
├── .gitignore                        # Git ignore patterns
├── Dockerfile                        # Production Docker build (node:18.20.5-alpine)
├── Dockerfile.dev                    # Development Docker build (ECR node:17.9.1)
├── Dockerfile.staging                # Staging Docker build (ECR node:17.9.1)
├── README.md                         # Project readme (contains Mermaid diagram link)
├── jsconfig.json                     # IDE path alias configuration
├── package.json                      # Dependencies & scripts
├── package-lock.json                 # Locked dependency tree
├── server.js                         # ★ ENTRY POINT — Express app, middleware, proxy
│
└── src/
    ├── InitApp/
    │   └── index.js                  # ★ App bootstrap — DB connect, session, middleware
    │
    ├── apis/
    │   ├── controllers/
    │   │   └── v1/
    │   │       ├── Auth.js           # ★ Core controller — getToken, verifyToken, payload builders
    │   │       └── index.js          # Exports AuthController
    │   │
    │   ├── services/
    │   │   └── v1/
    │   │       ├── Auth.js           # ★ Token operations — issueToken, verifyToken
    │   │       ├── Logistic/
    │   │       │   └── index.js      # ★ Inter-service call to LMS for delivery profile
    │   │       └── index.js          # Exports AuthService
    │   │
    │   ├── routes/
    │   │   ├── index.js              # ★ Main router — healthcheck, Swagger, v1 mount
    │   │   └── v1/
    │   │       ├── Auth.js           # ★ Route definitions — GET /token/:userId, etc.
    │   │       └── index.js          # Mounts Auth router
    │   │
    │   ├── db/
    │   │   └── index.js              # ★ MongoDB Singleton connection class
    │   │
    │   └── models/
    │       └── Users.js              # ★ Mongoose User schema
    │
    ├── common/
    │   ├── helper/
    │   │   └── index.js              # Exports AccessEnv (duplicate of utility)
    │   │
    │   ├── libs/
    │   │   ├── AuthManager/
    │   │   │   └── index.js          # ★ JWT engine — issueTokens, verifyToken, decodeAuthToken, requiresScopes
    │   │   ├── ErrorHandler/
    │   │   │   ├── index.js          # ★ AppError class — centralized error handling
    │   │   │   └── reqToCurl.js      # Converts request to cURL for logging
    │   │   ├── Logger/
    │   │   │   └── all-the-logs.log  # Log file (managed by Pino)
    │   │   ├── Validation/
    │   │   │   ├── Schemas.js        # Joi validation schema (userSchema)
    │   │   │   └── Validation.js     # Validation middleware factory
    │   │   ├── HttpResponseHandler.js# Standard success/error response formatter
    │   │   ├── RequestHandler.js     # Axios HTTP client wrapper (singleton)
    │   │   ├── Logger.js             # Simple logger (aliases console)
    │   │   ├── authorization.js      # Legacy JWT helper (not actively used)
    │   │   └── index.js              # Exports all libs
    │   │
    │   └── utility/
    │       ├── AccessEnv.js          # ★ Environment variable accessor with cache
    │       └── index.js              # Exports AccessEnv
    │
    ├── config/
    │   └── index.js                  # ★ Centralized config — reads env vars, exports structured config
    │
    ├── constants/
    │   ├── index.js                  # Aggregates all error constants
    │   └── errorConstants/
    │       ├── index.js              # Merges all error categories
    │       ├── authErrors.js         # Auth errors: ACCESSTOKEN_EXP, REFRESHTOKEN_EXP, UNAUTH_USER
    │       ├── otpErrors.js          # OTP errors: SEND_OTP_ERROR, VERIFY_OTP_ERROR
    │       └── serverErrors.js       # Server errors: INTERNAL_SERVER_ERROR, PAGE_NOT_FOUND, etc.
    │
    ├── openapi/
    │   └── openapi.json              # ★ OpenAPI 3.0.3 specification
    │
    └── scripts/
        ├── migrateLatest.js          # Knex migration: run latest (legacy, SQL)
        ├── migrateMake.js            # Knex migration: create new (legacy, SQL)
        └── migrateRollback.js        # Knex migration: rollback (legacy, SQL)
```

### 5.1 Key Files Explained

| File | Purpose | Why It Exists |
|------|---------|---------------|
| `server.js` | Creates the Express app, registers middleware (decode, cors, logger), mounts auth routes under `config.node.pathPrefix` (`/auth/apis`), sets up proxy, and starts the HTTP server on port 3200. | It is the **entry point**. The `InitApp` function is called first to bootstrap DB and session, then server.js layers on the routing and proxy. |
| `src/InitApp/index.js` | Connects to MongoDB (singleton), sets up CLS session namespace (for request-scoped logging), registers middleware. | Separates initialization concerns from routing. The session namespace allows correlating log entries across an async request lifecycle. |
| `src/apis/controllers/v1/Auth.js` | The brain of the service. Contains `getToken()`, `getUnauthorizeToken()`, `verifyToken()`, `generateToken()`. Also contains payload builders: `generateRetailerData()`, `generateLogisticData()`, `generateAdminData()`, `generateGeneralData()`. | Orchestrates the full token generation workflow — user lookup, cross-service data fetching, payload construction, delegation to service layer. |
| `src/apis/services/v1/Auth.js` | Thin wrapper around `AuthManager.issueTokens()` and `AuthManager.verifyToken()`. | Provides a service-layer abstraction. If the JWT library or token strategy changes, only this file (and AuthManager) need to change, not the controller. |
| `src/common/libs/AuthManager/index.js` | The JWT engine. `issueTokens()` signs access + refresh tokens. `verifyToken()` validates a token. `decodeAuthToken()` is Express middleware that decodes on every request. `requiresScopes()` is middleware that checks scope-based authorization. | Centralizes all JWT operations. Used both as local lib and the external `sarvm-utility` package provides its own AuthManager (there is a dual usage). |
| `src/apis/db/index.js` | Singleton MongoDB connection class. `connect()` bootstraps Mongoose and attaches the `Users` model. `getInstance()` provides access to the connected instance. | Ensures a single DB connection pool is shared across the application. |
| `src/apis/models/Users.js` | Mongoose schema for the `users` collection. Fields: `username`, `phone` (unique), `refreshTokenTimestamp`, `basicInformation` (personal details, KYC, transaction), `retailerData`, `deliveryData`, `householdData`. | Defines the shape of user documents. The auth_service reads user data from this collection (which is the same `ums` database used by the User Management Service). |

---

## 6. Core Functionality

### 6.1 JWT Token Generation (`issueTokens`)

**File**: `src/common/libs/AuthManager/index.js` → `issueTokens(payload)`

**What it does:**
1. Validates that `payload` is not null/undefined.
2. Creates an **access token** with these JWT options:
   - `subject`: `'accessToken'`
   - `algorithm`: `'HS256'`
   - `expiresIn`: From env (`365d` in all environments — see Section 11)
   - `notBefore`: `'120ms'` (token is not valid for the first 120ms after issuance — prevents race conditions)
   - `issuer`: `'sarvm:ums'`
3. Creates a **refresh token** with:
   - Same options but `subject: 'refreshToken'`, `expiresIn: REFRESH_TOKEN_EXPIRESIN` (also `365d`)
   - **Minimal payload**: Only `{ userId, scope: [] }` — the refresh token intentionally carries no permissions.
4. Special handling for logistics: If `payload.scope[1] === 'logisticsDelivery'`, the response body includes `{ onbording, subscribed }`.
5. Returns a frozen (immutable) object: `{ accessToken, refreshToken, body }`.

**Why HS256?**
- HS256 (HMAC-SHA256) is a symmetric signing algorithm. Both signing and verification use the same secret key. This is simpler to manage in a single-service architecture. The tradeoff is that the secret must be securely shared if multiple services need to verify tokens.

**Why `notBefore: '120ms'`?**
- Prevents a client from using the token the instant it's generated. The 120ms window accounts for clock drift and ensures the frontend has time to store the token before making the first authenticated request.

### 6.2 JWT Token Verification (`verifyToken`)

**File**: `src/common/libs/AuthManager/index.js` → `verifyToken(token)`

**What it does:**
1. Calls `jwt.verify(token, HS256_TOKEN_SECRET, callback)`.
2. If verification fails (expired, tampered, malformed), throws the error.
3. If valid, returns `true`.

**Where it is called:**
- In `server.js`, the catch-all `app.all('*')` handler calls `AuthController.verifyToken()` before proxying any request. This ensures that **every proxied request has a valid JWT**.

### 6.3 JWT Token Decoding (`decodeAuthToken` Middleware)

**File**: `src/common/libs/AuthManager/index.js` → `decodeAuthToken(req, res, next)`

**What it does:**
1. Reads `req.headers.authorization`.
2. If empty/missing, calls `next()` (does not block — unauthenticated requests can still proceed to public routes).
3. Splits the header: `"accessToken eyJhbGciOiJIUzI1NiIs..."` → subject = `'accessToken'`, token = `'eyJ...'`.
4. Calls `jwt.verify(token, secret)`.
5. If valid and `decoded.sub === jwtSubject`, sets `req.authPayload = decoded`.
6. If expired/invalid:
   - If subject was `accessToken` → calls `next(new ACCESSTOKEN_EXP_ERROR(err))`.
   - If subject was `refreshToken` → calls `next(new REFRESHTOKEN_EXP_ERROR(err))`.

**Why is this middleware, not a route handler?**
- It runs on **every** request. Downstream routes and controllers can then check `req.authPayload` without needing to decode the token again.

### 6.4 Scope-Based Authorization (`requiresScopes`)

**File**: `src/common/libs/AuthManager/index.js` → `requiresScopes(scopes)`

**What it does:**
1. Returns an Express middleware function.
2. Checks if `req.authPayload` exists (was decoded by `decodeAuthToken`).
3. Checks if the token's `scope` array has any intersection with the required `scopes`.
4. If yes → `next()` (authorized).
5. If no → `next(new UNAUTH_USER)` (forbidden).

**Where it is used:**
- Not currently wired into any routes in the auth_service itself, but available for use. The `sarvm-utility` package likely uses this pattern in downstream services.

### 6.5 Payload Construction (Per-App Token Payloads)

The controller builds different JWT payloads depending on the `app_name`:

#### `generateRetailerData(user, headers, body)` — For `retailerApp`

**Payload fields:**
| Field | Value | Why |
|-------|-------|-----|
| `entityType` | `'SU'` (Shop User) | Identifies the entity type for the platform |
| `entityId` | `shopId` (from RMS) | Primary entity the user operates on |
| `userId` | MongoDB `_id` | User identity |
| `phone` | from User document | User's phone number |
| `userType` | `'RETAILER'` (overridden by `getUserType`) | App-specific user type |
| `shopId` | from RMS API | The shop this retailer manages |
| `shopUniqueId` | from RMS API (`id` field) | Unique shop identifier |
| `isEmployee` | `userType.includes('EMPLOYEE')` | Whether the user is an employee (sales rep) |
| `shopMeta` | `{ shop, flag: { onBoarding, isSubscribed, GST_no, isKYCVerified } }` | Full shop metadata and onboarding flags |
| `segmentId` | `'retailer'` | User segment for analytics/targeting |
| `flyyUserId` | `"retaile-<flyyUserId>"` (`app_name.slice(0, -3) + '-' + flyyUserId`) | Flyy rewards platform user ID |
| `scope` | `['Users', 'retailerApp']` | Authorization scope array |

**The RMS API call:**
```javascript
const shopApiResponse = await getAllShopViaUserId({ headers, body });
```
- This calls the Retailer Management Service internally to get the shop details linked to this user.
- If the user has a shop, the shop data is embedded in the token. If not, `shopId` is `null` and `shopMeta.flag.onBoarding` is `false`.

#### `generateLogisticData(user, headers, body)` — For `logisticsDelivery`

**Additional fields:**
| Field | Value | Why |
|-------|-------|-----|
| `entityType` | `'LU'` (Logistics User) | Logistics entity type |
| `onbording` | from LMS API | Driver's onboarding completion status |
| `subscribed` | from LMS API | Driver's subscription status |

**The LMS API call:**
```javascript
const { deliveryData } = await logisticInformation(userId);
// Calls: GET ${INTERNAL_LOAD_BALANCER}/lms/apis/v1/profile/${userId}
```

#### `generateAdminData(user, headers, body)` — For `admin`

**Additional fields:**
| Field | Value | Why |
|-------|-------|-----|
| `adminData` | `{ status, role }` from `user.adminData` | Admin status and role |
| `scope` | `['ADMIN']` | Admin-only scope |

#### `generateGeneralData(user, headers, body)` — Fallback for other apps

- Used for `householdApp` and any other app not explicitly handled.
- Standard payload without shop/logistics/admin data.

### 6.6 Segment Determination (`getSegment`)

Maps the user's `app_name` and `userType` to a segment identifier used for analytics and targeting:

| app_name | userType | segmentId |
|----------|----------|-----------|
| `retailerApp` | any | `'retailer'` |
| `householdApp` | `EMPLOYEE_SH` | `'sales_employee_sh'` |
| `householdApp` | `EMPLOYEE_SSO` | `'sales_employee_sso'` |
| `householdApp` | `EMPLOYEE_CO` | `'sales_employee_co'` |
| `householdApp` | default | `'household'` |
| `logisticsDelivery` | any | `'logistics_delivery'` |
| `admin` | active | `user.adminData.role` |
| `admin` | inactive | `'non-admin'` |
| other | — | throws `INTERNAL_SERVER_ERROR` |

### 6.7 User Type Mapping (`getUserType`)

Overrides the database `userType` based on the requesting application:

| app_name | Returned userType |
|----------|-------------------|
| `retailerApp` | `'RETAILER'` |
| `logisticsDelivery` | `'LOGISTICS_DELIVERY'` |
| `admin` | `'ADMIN'` |
| other | Original `userType` from DB |

### 6.8 Health Check

**Endpoint**: `GET /auth/apis/healthcheck`

Returns:
```json
{
  "success": true,
  "data": {
    "ts": "2026-04-11T10:00:00.000Z",
    "buildNumber": "101"
  }
}
```

**Why?** Used by load balancers and monitoring systems to verify the service is running. Returns the current timestamp and build number.

---

## 7. APIs & Integrations

### 7.1 Exposed APIs (Auth Service Endpoints)

#### `GET /auth/apis/v1/token/:userId`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate authenticated JWT tokens for a verified user |
| **When called** | After successful OTP verification by the User Management Service |
| **Path params** | `userId` — MongoDB ObjectId of the user |
| **Required headers** | `app_name` (e.g., `retailerApp`), `app_version_code` (e.g., `101`), `Authorization` (existing JWT) |
| **Response** | `{ success: true, data: { accessToken, refreshToken, body } }` |
| **Calls internally** | MongoDB (User lookup), RMS `getAllShopViaUserId` (for retailerApp), LMS `/lms/apis/v1/profile/:userId` (for logisticsDelivery) |
| **Error cases** | User not found → `INTERNAL_SERVER_ERROR`, RMS/LMS call failure → `INTERNAL_SERVER_ERROR` |

#### `GET /auth/apis/v1/unauth_token`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate anonymous JWT tokens for unauthenticated access |
| **When called** | On app launch, before the user logs in |
| **Required headers** | `app_name`, `app_version_code` |
| **Response** | `{ success: true, data: { accessToken, refreshToken, body } }` |
| **Payload** | `{ userId: 'anonymous', scope: [app_name] }` |

#### `POST /auth/apis/v1/token`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Generate JWT tokens from an arbitrary payload |
| **When called** | Internal/programmatic token generation |
| **Request body** | Any JSON payload to embed in the JWT |
| **Response** | `{ success: true, data: { accessToken, refreshToken, body } }` |

#### `GET /auth/apis/healthcheck`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Service health check |
| **Response** | `{ success: true, data: { ts, buildNumber } }` |

#### `GET /auth/apis/apidocs`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Swagger UI for API documentation |
| **Response** | Interactive OpenAPI documentation page |

### 7.2 Proxy Endpoints (Pass-Through)

Any request not matching `/auth/apis/*` is proxied to `INTERNAL_LOAD_BALANCER` after JWT verification:

| Request Path Pattern | Proxied To | Target Service |
|---------------------|------------|----------------|
| `/rms/apis/v1/*` | `INTERNAL_LB/rms/apis/v1/*` | Retailer Management Service |
| `/ums/apis/v1/*` | `INTERNAL_LB/ums/apis/v1/*` | User Management Service |
| `/oms/apis/v1/*` | `INTERNAL_LB/oms/apis/v1/*` | Order Service |
| `/cms/apis/v1/*` | `INTERNAL_LB/cms/apis/v1/*` | Catalogue Management Service |
| `/lms/apis/v1/*` | `INTERNAL_LB/lms/apis/v1/*` | Logistics Management Service |
| `/whs/*` | `INTERNAL_LB/whs/*` | WebSocket/Warehouse Service (no auth) |

### 7.3 Consumed APIs (Outbound Calls)

#### `sarvm-utility` → `apiServices.rms.getAllShopViaUserId`

| Attribute | Value |
|-----------|-------|
| **Called from** | `AuthController.generateRetailerData()` |
| **Why** | Fetch shop details (shop_id, KYC, subscription, GST) to embed in the retailer's JWT payload |
| **Input** | `{ headers: { Content-Type, Accept, app_name, app_version_code, Authorization }, body: { userId } }` |
| **Output** | `{ success: true, data: [{ shop_id, id, isKYCVerified, isSubscribed, GST_no, ... }] }` |

#### `axios` → `GET ${INTERNAL_LOAD_BALANCER}/lms/apis/v1/profile/:userId`

| Attribute | Value |
|-----------|-------|
| **Called from** | `Logistic/index.js` → `logisticInformation(userId)` |
| **Why** | Fetch logistics delivery profile for drivers to include onboarding and subscription status in their JWT |
| **Input** | `userId` as path parameter |
| **Output** | `{ data: { deliveryData: { onbording, subscribed } } }` |

### 7.4 OpenAPI Specification

The service provides an OpenAPI 3.0.3 specification at `src/openapi/openapi.json` and serves it via Swagger UI at `/auth/apis/apidocs`.

**Servers defined:**
| Environment | URL |
|-------------|-----|
| Local | `http://localhost:3200/` |
| Production | `https://api.sarvm.ai/` |
| Staging (UAT) | `https://uat-api.sarvm.ai/` |

**Schemas defined:**
- `Token`: `{ success: boolean, data: { accesstoken: string, refreshtoken: string } }`
- `Success`: `{ success: boolean, data: object }`
- `Error`: `{ success: false, error: { code: string, originalError: string, message: string } }`

---

## 8. Database Design

### 8.1 Database Details

| Property | Value |
|----------|-------|
| **Database Engine** | MongoDB (AWS DocumentDB in cloud environments) |
| **Database Name** | `ums` (User Management System) |
| **Collection** | `users` |
| **ODM** | Mongoose v6.10.0 |
| **Connection Pattern** | Singleton class (`db` class with static instance) |

### 8.2 User Schema

**File**: `src/apis/models/Users.js`

```javascript
const UserSchema = new mongoose.Schema({
  username:               { type: String },
  phone:                  { type: String, required: true, unique: true },
  refreshTokenTimestamp:  { type: Number, required: true, default: Math.round(new Date().getTime() / 1000) },
  basicInformation: {
    personalDetails: {
      firstName:              String,
      lastName:               String,
      FathersName:            String,
      DOB:                    Date,
      Gender:                 String,
      secondaryMobileNumber:  String,
      emailID:                String,
    },
    kycDetails:       { kycId: String },
    transactionDetails: { transactionDetailsId: String },
  },
  retailerData:   {},   // Flexible sub-document for retailer-specific data
  deliveryData:   {},   // Flexible sub-document for delivery-specific data
  householdData:  {},   // Flexible sub-document for household-specific data
});
```

### 8.3 Field-by-Field Explanation

| Field | Type | Required | Why |
|-------|------|----------|-----|
| `username` | String | No | Display name (not used in auth flow) |
| `phone` | String | Yes, unique | Primary identifier for OTP-based auth. Unique constraint ensures no duplicate accounts. |
| `refreshTokenTimestamp` | Number | Yes | Unix timestamp. Can be used to invalidate refresh tokens by comparing against token issuance time. Default is current time at document creation. |
| `basicInformation.personalDetails` | Object | No | User's personal info. Not used in auth_service directly, but exists on the shared User document. |
| `basicInformation.kycDetails` | Object | No | KYC verification ID. Referenced indirectly when shopMeta.isKYCVerified is checked. |
| `basicInformation.transactionDetails` | Object | No | Payment/transaction reference. Not used in auth flow. |
| `retailerData` | Mixed | No | Placeholder for retailer-specific data. Schema-less to allow flexibility. |
| `deliveryData` | Mixed | No | Placeholder for delivery driver data. The auth_service reads `deliveryData` from the LMS API, not directly from this field. |
| `householdData` | Mixed | No | Placeholder for household user data. |

**Additional fields from user document (not explicitly in schema but accessed via `user.toObject()`):**
- `userType` — e.g., `'RETAILER'`, `'EMPLOYEE_SH'`, `'EMPLOYEE_SSO'`, `'EMPLOYEE_CO'`
- `flyyUserId` — Flyy rewards platform integration
- `adminData` — `{ status: 'active'/'inactive', role: 'admin'/'superadmin'/etc. }` (accessed as `user._doc.adminData`)

### 8.4 Database Connection Flow

```mermaid
sequenceDiagram
    participant App as server.js
    participant Init as InitApp
    participant DB as db class (Singleton)
    participant Mongoose as Mongoose
    participant DocDB as AWS DocumentDB

    App->>Init: InitApp(app)
    Init->>DB: new DB()
    Note right of DB: Constructor checks db.instance<br/>If null, sets db.instance = this
    Init->>DB: db.connect()
    DB->>Mongoose: mongoose.set('strictQuery', true)
    DB->>Mongoose: mongoose.connect(MONGO_URL)
    Mongoose->>DocDB: TCP connection
    DocDB-->>Mongoose: Connected
    Mongoose-->>DB: 'Mongodb Connected successfully'
    DB->>DB: this.Users = UserModel (attach model)

    Note over App,DocDB: Later, in controller:
    App->>DB: db.getInstance()
    DB-->>App: { Users: UserModel }
    App->>Mongoose: Users.findById(userId)
    Mongoose->>DocDB: Query
    DocDB-->>App: User document
```

### 8.5 Connection URIs by Environment

| Environment | URI Pattern | Database |
|-------------|-------------|----------|
| Local | `mongodb://localhost:27017/ums` | Local MongoDB |
| Dev | `mongodb://sarvmdev:***@dev-db.cluster-*.docdb.amazonaws.com/ums?retryWrites=false` | AWS DocumentDB (dev cluster) |
| Staging (UAT) | `mongodb://sarvmUATRead:***@uat.cluster-*.docdb.amazonaws.com/ums?retryWrites=false` | AWS DocumentDB (UAT cluster) |
| Production | `[]` (placeholder) | AWS DocumentDB (prod cluster) |

> **Note**: `retryWrites=false` is required for AWS DocumentDB, which does not support retryable writes (a MongoDB 3.6+ feature).

---

## 9. Setup & Installation

### 9.1 Prerequisites

- **Node.js** >= 18.x (recommended: 18.20.5)
- **MongoDB** (local) or access to AWS DocumentDB
- **npm** (comes with Node.js)
- Access to `sarvm-utility` package (requires AWS CodeCommit credentials)

### 9.2 Environment Variables

Create a `.env` file based on `.env.example`:

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Runtime environment | `development` |
| `ENV` | Environment name | `dev` / `stg` / `prd` |
| `BUILD_NUMBER` | Build identifier | `101` |
| `HOST` | Server host | `localhost` |
| `HOST_PORT` | Server port | `3200` |
| `HOST_SERVICE_NAME` | Service name (used in URL prefix) | `auth` |
| `MONGO_URL` | MongoDB connection string | `mongodb://localhost:27017/ums` |
| `HS256_TOKEN_SECRET` | JWT signing secret | `sarvm` |
| `ACCESS_TOKEN_EXPIRESIN` | Access token TTL | `365d` |
| `REFRESH_TOKEN_EXPIRESIN` | Refresh token TTL | `365d` |
| `INTERNAL_LOAD_BALANCER` | Internal service mesh URL | `http://localhost` |
| `LOAD_BALANCER` | Public load balancer URL | `http://localhost` |
| `PINO_LOG_LEVEL` | Logging level | `info` |
| `SESSION_NAME` | CLS session namespace name | `logger_session` |

### 9.3 Installation Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd backend/auth_service

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .lcl.env
# Edit .lcl.env with your local configuration

# 4. Start the server (local development)
npm run lcl

# 5. Start with dev environment
npm run lcl:dev

# 6. Start with staging environment
npm run lcl:stg

# 7. Start with production environment
npm run lcl:prd
```

### 9.4 NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `lcl` | `nodemon -r dotenv/config ./server dotenv_config_path=./.lcl.env` | Local dev with local MongoDB |
| `lcl:dev` | `nodemon -r dotenv/config ./server dotenv_config_path=./.dev.env` | Local dev with dev DocumentDB |
| `lcl:stg` | `nodemon -r dotenv/config ./server dotenv_config_path=./.stg.env` | Local dev with staging DocumentDB |
| `lcl:prd` | `nodemon -r dotenv/config ./server dotenv_config_path=./.prd.env` | Local dev with prod DocumentDB |
| `prd` | `nodemon ./server` | Production (env vars injected by container) |
| `stg` | `nodemon ./server` | Staging (env vars injected by container) |
| `test` | `mocha ./unitTests/ --recursive` | Run unit tests (with 8GB heap) |
| `mdb-latest-dev` | `node -r dotenv/config ./src/scripts/migrateLatest.js ...` | Run Knex migrations (legacy) |
| `mdb-make-lcl` | `node -r dotenv/config ./src/scripts/MigrateMake.js ...` | Create Knex migration (legacy) |
| `mdb-rollback-dev` | `node -r dotenv/config ./src/scripts/migrateRollback.js ...` | Rollback Knex migrations (legacy) |

### 9.5 Docker Build

```bash
# Production build
docker build -t auth-service:latest \
  --build-arg BUILD_NUMBER=101 \
  -f Dockerfile .

# Dev build
docker build -t auth-service:dev \
  --build-arg BUILD_NUMBER=101 \
  -f Dockerfile.dev .

# Staging build
docker build -t auth-service:staging \
  --build-arg BUILD_NUMBER=101 \
  -f Dockerfile.staging .
```

**Docker architecture (multi-stage):**
1. **Build stage**: Uses full Node image, runs `npm ci` to install dependencies.
2. **Runtime stage**: Uses Alpine-based image, copies built `node_modules` and `src/`.
3. **Exposed port**: `3200`.
4. **Start command**: `NODE_ENV=production npm run-script stg` (production) / `NODE_ENV=development npm run-script stg` (dev/staging).

### 9.6 Module Aliases

The service uses `module-alias` to provide clean import paths:

| Alias | Maps To | Usage |
|-------|---------|-------|
| `@root` | `.` | Project root |
| `@controllers` | `src/apis/controllers` | `require('@controllers/v1')` |
| `@services` | `src/apis/services` | `require('@services/v1')` |
| `@db` | `src/apis/db` | `require('@db')` |
| `@models` | `src/apis/models` | `require('@models/Users')` |
| `@routes` | `src/apis/routes` | `require('@routes')` |
| `@constants` | `src/constants` | `require('@constants')` |
| `@config` | `src/config` | `require('@config')` |
| `@common` | `src/common` | `require('@common/libs')` |

---

## 10. User Flow

### 10.1 Complete Authentication Lifecycle

```mermaid
graph TD
    A["App Launch"] --> B["Request Anonymous Token"]
    B --> C["GET /auth/apis/v1/unauth_token"]
    C --> D["Receive { accessToken, refreshToken }<br/>userId: 'anonymous'"]
    D --> E["User Enters Phone Number"]
    E --> F["OTP Request via UMS<br/>(proxied through auth_service)"]
    F --> G["OTP Verified via UMS<br/>(proxied through auth_service)"]
    G --> H["UMS returns userId"]
    H --> I["Request Authenticated Token"]
    I --> J["GET /auth/apis/v1/token/:userId"]
    J --> K["Auth Service looks up user in MongoDB"]
    K --> L{"Which app?"}
    
    L -->|retailerApp| M["Call RMS for shop data"]
    L -->|logisticsDelivery| N["Call LMS for delivery profile"]
    L -->|admin| O["Read adminData from user doc"]
    L -->|other| P["Use general payload"]
    
    M --> Q["Build retailer JWT payload"]
    N --> R["Build logistics JWT payload"]
    O --> S["Build admin JWT payload"]
    P --> T["Build general JWT payload"]
    
    Q --> U["Sign JWT tokens"]
    R --> U
    S --> U
    T --> U
    
    U --> V["Return { accessToken, refreshToken }"]
    V --> W["Frontend stores tokens"]
    W --> X["All subsequent API calls include<br/>Authorization: accessToken <jwt>"]
    X --> Y["Auth Service verifies token"]
    Y --> Z["Proxy to internal service"]
    Z --> AA["Service processes request"]
    AA --> AB["Response back through proxy"]
```

### 10.2 Step-by-Step: Retailer App Login

| Step | Actor | Action | Why |
|------|-------|--------|-----|
| 1 | App | Launches and calls `GET /auth/apis/v1/unauth_token` with `app_name: retailerApp` | Needs a token to make any backend call, even unauthenticated ones |
| 2 | Auth Service | Issues anonymous JWT with `userId: 'anonymous'`, `scope: ['retailerApp']` | Anonymous token allows the app to call UMS for OTP |
| 3 | App | Sends OTP request via `POST /ums/apis/v1/otp/send` (proxied through auth) | User enters phone number |
| 4 | Auth Service | Verifies anonymous token, then proxies to UMS | Gateway performs auth check before forwarding |
| 5 | UMS | Sends OTP via SMS | User receives OTP on phone |
| 6 | App | Submits OTP via `POST /ums/apis/v1/otp/verify` (proxied through auth) | User enters OTP |
| 7 | UMS | Verifies OTP, creates/finds user, returns `userId` | OTP verification is handled by UMS, not auth_service |
| 8 | App | Calls `GET /auth/apis/v1/token/:userId` | Requests authenticated tokens |
| 9 | Auth Service | Looks up user in `ums.users` collection | Needs user data (phone, userType, flyyUserId) for JWT payload |
| 10 | Auth Service | Calls RMS `getAllShopViaUserId` | Needs shop data for the retailer's JWT |
| 11 | Auth Service | Builds retailer payload, signs JWT | Creates access + refresh tokens |
| 12 | App | Receives and stores tokens | All future requests use these tokens |
| 13 | App | Makes API calls (e.g., `GET /rms/apis/v1/shop/list`) | Authorization header: `accessToken <jwt>` |
| 14 | Auth Service | Decodes JWT, verifies token, proxies to RMS | Every request goes through auth gatekeeper |
| 15 | RMS | Processes request, returns response | Response flows back through the proxy |

### 10.3 Token Refresh Flow

> **Note:** The current codebase does not have an explicit **refresh token endpoint**. The refresh token is issued but there is no `/auth/apis/v1/refresh` endpoint. The current approach relies on the very long token expiry (365 days) which effectively makes tokens perpetual. A proper refresh mechanism is listed in [Future Improvements](#13-future-improvements).

---

## 11. Edge Cases & Limitations

### 11.1 Security Concerns

| Issue | Description | Impact |
|-------|-------------|--------|
| **365-day token expiry** | Both access and refresh tokens expire after 365 days. This is effectively a permanent token. | If a token is compromised, the attacker has up to a year of access. Industry standard is 15-30 minutes for access tokens and hours/days for refresh tokens. |
| **Hardcoded JWT secret** | The `HS256_TOKEN_SECRET` is `sarvm` across all environments. | A known/simple secret defeats the purpose of JWT signing. Anyone who knows the secret can forge tokens. |
| **No token revocation** | There is no mechanism to invalidate issued tokens. The `refreshTokenTimestamp` field exists in the User schema but is not checked during verification. | A compromised token cannot be revoked until it expires. |
| **No rate limiting** | No rate limiting on token generation endpoints. | Susceptible to brute-force attempts. |

### 11.2 Code Issues

| Issue | Description | Impact |
|-------|-------------|--------|
| **Duplicate middleware** | `InitApp/index.js` and `server.js` both register `decodeAuthToken`, `cors()`, `urlencoded()`, and `ReqLogger`. | Every request passes through these middleware **twice**, causing unnecessary overhead and potential double-logging. |
| **Dual AuthManager** | The service imports `AuthManager` from both `sarvm-utility` (in `server.js` and `InitApp`) and local `@common/libs/AuthManager` (in `services/v1/Auth.js`). | Two different AuthManager implementations could cause inconsistencies if they diverge. |
| **Legacy SQL dependencies** | `knex`, `mysql`, `objection` are in `package.json` but the service uses MongoDB. Migration scripts reference a non-existent `../knex/knex` path. | Dead code and unnecessary dependency weight (~2MB+). |
| **Missing token refresh endpoint** | No endpoint to exchange a refresh token for a new access token. | Clients must re-authenticate (full OTP flow) when tokens expire, or rely on the 365-day expiry. |
| **Unused validation** | Joi schemas and validation middleware exist but are not wired into any route. | No request validation on any endpoint — any malformed request reaches the controller. |
| **`authorization.js` — Dead code** | `src/common/libs/authorization.js` contains a standalone JWT implementation with hardcoded keys. It references `req` without it being in scope. | Non-functional dead code. |
| **`package.json` name mismatch** | `package.json` has `"name": "user_mgmt_service"` instead of `auth_service`. | Misleading, likely copied from user_mgmt_service template. |
| **No request body parsing for JSON** | `express.json()` is commented out in both `InitApp` and `server.js`. Only `urlencoded` is enabled. | POST requests sending JSON bodies (e.g., `POST /token`) may not be parsed correctly. |
| **Error response inconsistency** | `verifyToken()` in the catch-all proxy throws `INTERNAL_SERVER_ERROR` for invalid tokens, which returns HTTP 500. | Invalid tokens should return 401 (Unauthorized), not 500. |

### 11.3 Architectural Edge Cases

| Case | Behavior |
|------|----------|
| **User deleted after token issued** | Token remains valid until expiry. No re-validation against DB on each request (stateless JWT). |
| **Shop deleted/changed after token issued** | JWT payload is stale — shopId, shopMeta are embedded at token generation time. Client must re-request a token. |
| **Database unavailable** | `getToken()` will throw `INTERNAL_SERVER_ERROR`. The proxy flow (`verifyToken`) does not require DB, only JWT signature verification. |
| **Internal load balancer down** | All proxy requests fail. Token generation for retailer/logistics apps also fails (cross-service calls). |
| **Unknown `app_name`** | `getSegment()` throws `INTERNAL_SERVER_ERROR`. `getUserType()` returns the raw DB `userType`. |
| **`/whs/*` requests** | Proxied **without any authentication**. Any client can make WebSocket connections without a token. |
| **Concurrent token requests** | No locking. Multiple valid tokens can be issued simultaneously for the same user. |

---

## 12. Performance & Scalability

### 12.1 Current Performance Characteristics

| Aspect | Current State |
|--------|---------------|
| **Stateless auth** | JWT verification requires no DB lookup (just signature validation). This makes the proxy path extremely fast. |
| **DB connection pooling** | Singleton Mongoose connection with default pool settings. No custom pool configuration (`min`/`max`). |
| **Token generation latency** | Depends on cross-service calls. For retailerApp: 1 DB query + 1 HTTP call to RMS. For logisticsDelivery: 1 DB query + 1 HTTP call to LMS. |
| **Proxy overhead** | Minimal — `http-proxy-middleware` streams the request/response without buffering. |
| **Memory** | Node.js single-threaded. No clustering or worker threads configured. |

### 12.2 Bottlenecks

| Bottleneck | Why |
|-----------|-----|
| **Single-threaded Node.js** | Under heavy load, the single event loop may become saturated. No clustering (`pm2`, `cluster` module) is configured. |
| **Cross-service calls during token gen** | `getToken()` for retailerApp makes a synchronous HTTP call to RMS. If RMS is slow, token generation is slow. |
| **No caching** | User data and shop data are fetched from DB/services on every token request. No Redis/in-memory cache. |
| **Duplicate middleware execution** | Every request runs decode, cors, urlencoded, and logging twice. |
| **No connection pool tuning** | Default Mongoose pool size may be insufficient under heavy load. |

### 12.3 Scalability Strategies

| Strategy | Current | Recommended |
|----------|---------|-------------|
| **Horizontal scaling** | Docker containers (potentially on ECS/EKS) | Add auto-scaling based on CPU/request metrics |
| **Caching** | None | Add Redis cache for user data, shop data (TTL: 5-10 minutes) |
| **Token verification** | Every request | Consider moving to API Gateway (AWS API Gateway, Kong) for token verification at the edge |
| **Connection pooling** | Default | Configure `pool: { min: 5, max: 20 }` in Mongoose |
| **Clustering** | None | Use `pm2` or Node.js `cluster` module to utilize all CPU cores |
| **Circuit breaking** | None | Add circuit breaker (e.g., `opossum`) for RMS/LMS calls |

---

## 13. Future Improvements

### 13.1 Critical (Security)

1. **Reduce token expiry**: Change access token to 15-30 minutes, refresh token to 7-30 days.
2. **Implement refresh token endpoint**: `POST /auth/apis/v1/refresh` that accepts a refresh token and returns a new access token.
3. **Strengthen JWT secret**: Replace `sarvm` with a cryptographically random 256-bit secret. Use per-environment secrets.
4. **Token revocation**: Check `refreshTokenTimestamp` against the token's `iat` (issued-at) during verification. If the user's timestamp is newer, reject the token.
5. **Rate limiting**: Add rate limiting middleware (e.g., `express-rate-limit`) on token generation endpoints.

### 13.2 High Priority (Architecture)

6. **Remove duplicate middleware**: Consolidate InitApp and server.js middleware chains. Remove the duplicate `decodeAuthToken`, `cors()`, `urlencoded()`, and `ReqLogger` registrations.
7. **Enable JSON body parsing**: Uncomment `express.json({ limit: '1mb' })` so POST endpoints work correctly.
8. **Unify AuthManager**: Use either `sarvm-utility`'s AuthManager or the local one, not both.
9. **Return 401 for invalid tokens**: Change `verifyToken()` to throw a proper `UNAUTH_USER` error (HTTP 401) instead of `INTERNAL_SERVER_ERROR` (HTTP 500).
10. **Secure `/whs/*` route**: Add authentication to the WebSocket proxy or at minimum validate the origin.

### 13.3 Medium Priority (Code Quality)

11. **Remove legacy SQL dependencies**: Remove `knex`, `mysql`, `objection`, and the migration scripts.
12. **Fix `package.json` name**: Change from `user_mgmt_service` to `auth_service`.
13. **Remove dead code**: Delete `authorization.js`, clean up commented-out code blocks.
14. **Wire up validation**: Use the existing Joi schemas and validation middleware in route definitions.
15. **Add unit tests**: The `test` script exists but the `unitTests/` directory is missing.

### 13.4 Low Priority (Nice-to-Have)

16. **Add request/response logging for proxy**: Log which internal service handled each proxied request.
17. **Add OpenAPI spec for proxy endpoints**: Document all proxied endpoints in the OpenAPI spec.
18. **Environment-specific configs**: Ensure production has different secrets, shorter token expiry, and proper logging configuration.
19. **Health check improvements**: Add MongoDB connection status, memory usage, and uptime to the health check response.
20. **Monitoring**: Add APM (Application Performance Monitoring) integration (commented-out code suggests this was planned).

---

## 14. Summary

### 14.1 What the Auth Service Is

The Sarvm Auth Service is a **dual-purpose Node.js/Express application** that functions as both an **authentication provider** and an **API gateway (reverse proxy)** for the Sarvm microservices ecosystem.

### 14.2 Key Responsibilities

| # | Responsibility | Implementation |
|---|---------------|----------------|
| 1 | **Token Generation** | JWT access + refresh tokens via `AuthManager.issueTokens()`. App-aware payloads (retailer, logistics, admin, general). |
| 2 | **Token Verification** | JWT signature verification via `AuthManager.verifyToken()`. Runs on every proxied request. |
| 3 | **Token Decoding** | Express middleware `decodeAuthToken()` decodes JWT and attaches payload to `req.authPayload`. |
| 4 | **API Gateway** | `http-proxy-middleware` forwards authenticated requests to internal services via `INTERNAL_LOAD_BALANCER`. |
| 5 | **Cross-Service Enrichment** | Calls RMS (shop data) and LMS (logistics profile) to build rich JWT payloads during token generation. |

### 14.3 Architecture Summary

```
Clients → Auth Service (Port 3200) → Internal Load Balancer → Microservices
                 │
                 ├── /auth/apis/v1/token/:userId   → Generate JWT
                 ├── /auth/apis/v1/unauth_token     → Anonymous JWT
                 ├── /auth/apis/v1/token (POST)     → Custom JWT
                 ├── /auth/apis/healthcheck         → Health check
                 ├── /whs/*                         → Proxy (no auth)
                 └── * (everything else)            → Verify JWT → Proxy
```

### 14.4 Technology Choices

- **JWT (HS256)** for stateless, scalable authentication
- **MongoDB/DocumentDB** for user data persistence
- **http-proxy-middleware** for transparent reverse proxying
- **sarvm-utility** for shared auth, logging, and error handling infrastructure
- **Docker multi-stage builds** for optimized container images
- **AWS infrastructure** (DocumentDB, ECR, CodeCommit, internal ALB/NLB)

### 14.5 Key Takeaways

1. The auth_service is the **front door** to the entire Sarvm backend. Every client request passes through it.
2. It combines two concerns (auth + proxy) in a single service, which simplifies deployment but creates a single point of failure.
3. JWT payloads are **rich and app-specific**, containing business data (shop info, onboarding flags, admin roles) embedded at token generation time.
4. The service relies heavily on **cross-service HTTP calls** during token generation, creating tight coupling with RMS and LMS.
5. There are significant **security concerns** (long-lived tokens, simple shared secret, no revocation) that should be addressed before scaling to production.

---

*Document generated: April 2026*  
*Service version: 1.0.0 | Build: 101*  
*Author: Auto-generated from codebase analysis*
