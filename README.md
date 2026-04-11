# 📘 Sarvm Auth Service — Complete Technical Documentation

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

The **Auth Service** is a centralized authentication and authorization microservice within the Sarvm backend ecosystem. It is the **gateway guard** — every single HTTP request that hits the Sarvm platform must first pass through this service. It is responsible for:

- **Issuing JWT tokens** (access tokens + refresh tokens) to authenticated users.
- **Verifying JWT tokens** on every incoming request before proxying it to downstream microservices.
- **Acting as an API Gateway / Reverse Proxy**, forwarding authenticated requests to the internal load balancer which routes to the correct microservice (`retailer_service`, `user_mgmt_service`, `catalogue_mgmt_service`, `order_service`).
- **Supporting multiple client applications** (Retailer App, Household App, Logistics Delivery App, Admin Panel) with app-specific JWT payloads.

### 1.2 Why Does it Exist?

In a microservice architecture, each service should not independently handle authentication. The Auth Service provides a **single point of trust**:

- **Security Centralization:** One place to manage secret keys, token expiration, and verification logic.
- **Separation of Concerns:** Other microservices (retailer_service, order_service, etc.) don't need to know about JWT — they receive pre-verified requests.
- **API Gateway Pattern:** Instead of exposing every microservice directly, the auth_service proxies all requests. The client only talks to one endpoint.

### 1.3 Where Does it Sit in the Sarvm Ecosystem?

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Client Applications                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ Retailer App │  │ Household App│  │ Logistics  │  │ Admin     │ │
│  │              │  │              │  │ Delivery   │  │ Panel     │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  └─────┬─────┘ │
└─────────┼─────────────────┼────────────────┼────────────────┼───────┘
          │                 │                │                │
          └────────────┬────┴────────────────┴────────────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │   AUTH SERVICE (3200)  │  ◄── This Service
          │  ┌──────────────────┐  │
          │  │  Token Verify    │  │
          │  │  Token Issue     │  │
          │  │  Reverse Proxy   │  │
          │  └──────────────────┘  │
          └────────────┬───────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │ INTERNAL LOAD BALANCER │
          └────────────┬───────────┘
                       │
          ┌────────────┼────────────────────────────────┐
          │            │                                │
          ▼            ▼                ▼               ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
   │  Retailer  │ │ User Mgmt  │ │ Catalogue  │ │   Order    │
   │  Service   │ │  Service   │ │   Mgmt     │ │  Service   │
   └────────────┘ └────────────┘ └────────────┘ └────────────┘
```

The Auth Service runs on **port 3200** and is the **only publicly exposed** backend service. All other microservices sit behind the internal load balancer and are not directly accessible by clients.

### 1.4 The Dual Role

The Auth Service plays **two distinct roles simultaneously**:

1. **Authentication Service:** Manages JWT issuance and verification via its own REST API routes (`/auth/apis/v1/...`).
2. **API Gateway / Reverse Proxy:** For ALL requests that don't match its own routes, it verifies the JWT token and then proxies the request (using `http-proxy-middleware`) to the internal load balancer, which routes to the appropriate downstream microservice.

**Why this dual role?** Instead of deploying a separate API gateway (like Kong, NGINX, or AWS API Gateway), the auth service itself acts as the gateway. This simplifies the deployment topology — one fewer service to manage — while keeping token verification tightly coupled with the proxy layer (zero-latency between verification and forwarding).

---

## 2. System Architecture

### 2.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AUTH SERVICE (PORT 3200)                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Express.js Application                       │    │
│  │                                                                     │    │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────────┐                 │    │
│  │  │  InitApp    │  │ Middleware │  │   Router     │                 │    │
│  │  │  ─ MongoDB  │  │ ─ CORS    │  │  /healthcheck│                 │    │
│  │  │  ─ Session  │  │ ─ Morgan  │  │  /apidocs    │                 │    │
│  │  │  ─ CLS      │  │ ─ Decode  │  │  /v1/token   │                 │    │
│  │  │  ─ Decode   │  │   Token   │  │  /v1/unauth  │                 │    │
│  │  └─────────────┘  └────────────┘  └──────┬───────┘                 │    │
│  │                                          │                         │    │
│  │                            ┌─────────────┼──────────────┐          │    │
│  │                            ▼             ▼              ▼          │    │
│  │                     ┌────────────┐ ┌──────────┐ ┌──────────────┐   │    │
│  │                     │  Auth      │ │  Auth    │ │  Proxy       │   │    │
│  │                     │  Controller│ │  Service │ │  Middleware   │   │    │
│  │                     └─────┬──────┘ └────┬─────┘ └──────┬───────┘   │    │
│  │                           │             │              │           │    │
│  │                           ▼             ▼              ▼           │    │
│  │                     ┌────────────┐ ┌──────────┐ ┌──────────────┐   │    │
│  │                     │  MongoDB   │ │  Auth    │ │  Internal    │   │    │
│  │                     │  (Users)   │ │  Manager │ │  Load        │   │    │
│  │                     └────────────┘ │  (JWT)   │ │  Balancer    │   │    │
│  │                                    └──────────┘ └──────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Layered Architecture (MVC-S Pattern)

The service follows a **Modified MVC-S (Model-View-Controller-Service)** architecture:

```
Request ──▶ Route ──▶ Controller ──▶ Service ──▶ AuthManager / DB
                                                      │
Response ◀── Route ◀── Controller ◀── Service ◀───────┘
```

| Layer | Location | Responsibility | Why This Layer? |
|-------|----------|---------------|-----------------|
| **Routes** | `src/apis/routes/` | Maps HTTP verbs + paths to controller functions. Extracts headers, params, body, query from `req` and bundles them into a `dataValues` object. | Clean separation of HTTP transport from business logic. Enables route-level middleware (e.g., validation). |
| **Controllers** | `src/apis/controllers/` | Contains business logic — decides which payload to generate based on `app_name`, looks up the user in MongoDB, calls external services (RMS), and delegates token operations to the Service layer. | The "brain" of each request. Orchestrates data lookups, external API calls, and payload construction. |
| **Services** | `src/apis/services/` | Thin wrapper around `AuthManager`. Calls `issueTokens()` or `verifyToken()` and handles errors. | Abstraction layer so controllers don't directly depend on `AuthManager`. Enables swapping the auth implementation. |
| **AuthManager** | `src/common/libs/AuthManager/` | Core JWT library — signs tokens, verifies tokens, decodes tokens from request headers, and enforces scope-based authorization. | Low-level crypto operations isolated from business logic. Reusable across the application. |
| **Models** | `src/apis/models/` | Mongoose schema definitions for MongoDB collections. | Data shape enforcement and validation at the DB layer. |
| **DB** | `src/apis/db/` | Singleton class that manages the MongoDB/Mongoose connection and exposes model references. | Ensures a single database connection is reused across the app. |

### 2.3 Initialization Sequence

When the server starts, the following happens in exact order:

```
1. server.js
   └── require('module-alias/register')   ← Registers path aliases (@controllers, @services, etc.)
   └── InitApp(app)                        ← Async initialization
       │
       ├── 2. AuthManager.decodeAuthToken  ← Middleware: decode JWT from every request header
       ├── 3. CLS-Hooked session           ← Create continuation-local storage for sessionId and clientIp
       ├── 4. express.urlencoded()          ← Body parser for URL-encoded payloads
       ├── 5. cors()                        ← Enable Cross-Origin Resource Sharing
       ├── 6. ReqLogger                     ← Request logging middleware (skipped in test mode)
       ├── 7. new DB().connect()            ← Instantiate singleton DB, connect to MongoDB
       └── 8. Process error handlers        ← unhandledRejection + uncaughtException handlers
   │
   └── AFTER InitApp resolves:
       ├── 9. express.urlencoded()          ← Additional body parser (redundant but present)
       ├── 10. cors()                       ← Additional CORS (redundant but present)
       ├── 11. AuthManager.decodeAuthToken  ← Additional token decode (redundant but present)
       ├── 12. ReqLogger                    ← Request logger
       ├── 13. router (config.node.pathPrefix) ← Mount routes under /auth/apis
       │       ├── GET /healthcheck
       │       ├── /apidocs (Swagger UI)
       │       └── /v1/* (Auth routes)
       │
       ├── 14. Proxy: /whs                 ← Proxy for webhook service
       ├── 15. Catch-all: app.all('*')      ← Verify token + proxy to internal LB
       ├── 16. 404 handler                  ← PAGE_NOT_FOUND_ERROR
       ├── 17. Global error handler         ← BaseError check → handleError
       └── 18. app.listen(3200)             ← Start listening
```

**Why is `decodeAuthToken`, `cors()`, and `urlencoded()` seemingly duplicated between `InitApp` and `server.js`?**

`InitApp` was likely the original initialization, and `server.js` was later refactored to add more middleware. The duplication exists because `InitApp` sets up the very first middleware layer (before any routes are mounted), while `server.js` re-applies them after `InitApp` completes. In practice, Express middleware is cumulative — the second application doesn't break anything but does result in each request being processed twice by those middlewares. This is a minor technical debt that could be cleaned up.

### 2.4 The Proxy Gateway Pattern

The most architecturally significant aspect of this service is the **catch-all proxy** defined in `server.js`:

```javascript
app.all('*', 
  async (req, res, next) => {
    // 1. Extract JWT from headers
    // 2. Call AuthController.verifyToken() to validate it
    // 3. If valid, call next() to proceed to proxy
    // 4. If invalid, throw error → error handler
  },
  createProxyMiddleware(options) // Proxy to internal load balancer
);
```

**How it works:**
1. Any request that does NOT match the auth service's own routes (`/auth/apis/...`) falls through to this catch-all.
2. The auth service first **verifies the JWT token** from the `Authorization` header.
3. If the token is valid, the request is transparently **proxied** to the `INTERNAL_LOAD_BALANCER` URL.
4. The internal load balancer then routes it to the correct microservice based on the URL path prefix (e.g., `/rms/...` → retailer_service, `/ums/...` → user_mgmt_service).

**Why this pattern?**
- **Zero-trust perimeter:** No microservice can be accessed without a valid token.
- **Single entry point:** Clients only need to know one URL — the auth service.
- **Transparent proxying:** The client doesn't know it's being proxied. The auth service acts as a man-in-the-middle that adds trust.

The `/whs` (webhook service) route is proxied **without token verification** — this is because webhooks come from external systems (payment gateways, etc.) that don't have Sarvm JWT tokens.

---

## 3. Data Flow

### 3.1 Token Issuance Flow (Authenticated User)

This is the flow when a client app requests a JWT token after OTP verification:

```
┌──────────┐     GET /auth/apis/v1/token/:userId     ┌──────────────┐
│  Client  │ ──────────────────────────────────────▶  │  Auth Route  │
│  App     │     Headers: app_name, authorization     │  (v1/Auth.js)│
└──────────┘                                          └──────┬───────┘
                                                             │
                                           handleRESTReq extracts:
                                           - app_name, app_version_code
                                           - authorization, userId (params)
                                           - user (authPayload from decoded JWT)
                                                             │
                                                             ▼
                                                    ┌────────────────┐
                                                    │ AuthController │
                                                    │   getToken()   │
                                                    └────────┬───────┘
                                                             │
                                              ┌──────────────┼──────────────┐
                                              ▼              │              │
                                    ┌─────────────────┐      │              │
                                    │  MongoDB Lookup  │      │              │
                                    │ Users.findById() │      │              │
                                    └────────┬────────┘      │              │
                                             │               │              │
                                   user data returned        │              │
                                             │               │              │
                                   ┌─────────▼─────────┐     │              │
                                   │ Check app_name    │     │              │
                                   │ to decide payload │     │              │
                                   └─────────┬─────────┘     │              │
                                             │               │              │
                    ┌────────────────────┬────┴───────┬───────┴──────┐       │
                    ▼                    ▼            ▼              ▼       │
           ┌───────────────┐  ┌──────────────┐ ┌───────────┐ ┌──────────┐  │
           │ retailerApp   │  │ logisticsApp │ │ admin     │ │ others   │  │
           │ generateRet.. │  │ generateLog..│ │ generate..│ │ generate.│  │
           │               │  │              │ │           │ │ General..│  │
           │ ▼ Calls RMS   │  │ ▼ Calls LMS  │ │           │ │          │  │
           │   to get shop │  │   to get     │ │           │ │          │  │
           │   data        │  │   delivery   │ │           │ │          │  │
           │               │  │   data       │ │           │ │          │  │
           └───────┬───────┘  └──────┬───────┘ └─────┬─────┘ └────┬─────┘  │
                   │                 │               │            │         │
                   └────────┬────────┴───────────────┴────────────┘         │
                            ▼                                               │
                   ┌──────────────────┐                                     │
                   │  AuthService     │                                     │
                   │  issueToken()    │                                     │
                   └────────┬─────────┘                                     │
                            ▼                                               │
                   ┌──────────────────┐                                     │
                   │  AuthManager     │                                     │
                   │  issueTokens()   │                                     │
                   │                  │                                     │
                   │  ▼ Signs JWT     │                                     │
                   │    accessToken   │                                     │
                   │  ▼ Signs JWT     │                                     │
                   │    refreshToken  │                                     │
                   └────────┬─────────┘                                     │
                            │                                               │
                            ▼                                               │
                   ┌──────────────────┐                                     │
                   │  Response:       │                                     │
                   │  { accessToken,  │                                     │
                   │    refreshToken, │                                     │
                   │    body }        │                                     │
                   └──────────────────┘                                     
```

### 3.2 Token Verification & Proxy Flow (Every API Call)

This is the flow for every non-auth request — the gateway behavior:

```
┌──────────┐   ANY REQUEST (e.g., GET /rms/apis/v1/shops)   ┌──────────────┐
│  Client  │ ─────────────────────────────────────────────▶  │  server.js   │
│  App     │   Headers: Authorization: accessToken <jwt>     │  Express App │
└──────────┘                                                 └──────┬───────┘
                                                                    │
                         ┌──────────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Middleware Chain     │
              │                     │
              │ 1. decodeAuthToken  │ ← Extracts + decodes JWT, attaches to req.authPayload
              │ 2. CLS session      │ ← Attaches sessionId + clientIp
              │ 3. urlencoded       │ ← Parse body
              │ 4. cors             │ ← CORS headers
              │ 5. ReqLogger        │ ← Log request
              └─────────┬───────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ Route Matching      │
              │                     │
              │ /auth/apis/* ?      │──── YES ──▶ Handle internally (token routes)
              │                     │
              │ /whs ?              │──── YES ──▶ Proxy directly (no auth check)
              │                     │
              │ Everything else     │──── ▼
              └─────────┬───────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ app.all('*')        │
              │                     │
              │ 1. Extract headers  │
              │    + body           │
              │ 2. AuthController   │
              │    .verifyToken()   │
              │    ├── AuthService  │
              │    │   .verifyToken │
              │    │   ├── Auth     │
              │    │   │   Manager  │
              │    │   │   .verify  │
              │    │   │    Token() │
              │    │   │   ├── jwt  │
              │    │   │   │  .ver  │
              │    │   │   │  ify() │
              │    │   │   └───┘    │
              │    │   └───────┘    │
              │    └────────────┘   │
              │                     │
              │ 3. If valid:        │
              │    next() ──▶ Proxy │
              │                     │
              │ 4. If invalid:      │
              │    throw error      │
              └─────────┬───────────┘
                        │
                        ▼ (if valid)
              ┌─────────────────────┐
              │ createProxyMiddleware│
              │                     │
              │ target: INTERNAL_   │
              │   LOAD_BALANCER     │
              │ changeOrigin: true  │
              │ ws: true            │
              └─────────┬───────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ Internal Load       │
              │ Balancer            │
              │                     │
              │ Routes by path:     │
              │ /rms/* → retailer   │
              │ /ums/* → user_mgmt  │
              │ /cms/* → catalogue  │
              │ /oms/* → order      │
              │ /lms/* → logistics  │
              └─────────────────────┘
```

### 3.3 Anonymous Token Flow

For users who haven't logged in yet (e.g., browsing the app before OTP):

```
┌──────────┐   GET /auth/apis/v1/unauth_token    ┌──────────────┐
│  Client  │ ─────────────────────────────────▶   │  Auth Route  │
│  App     │   Headers: app_name                  └──────┬───────┘
└──────────┘                                             │
                                                         ▼
                                                ┌──────────────────┐
                                                │ AuthController   │
                                                │ getUnauthorize.. │
                                                │                  │
                                                │ payload = {      │
                                                │   userId:        │
                                                │     'anonymous', │
                                                │   scope:         │
                                                │     [app_name]   │
                                                │ }                │
                                                └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │ AuthService      │
                                                │ .issueToken()    │
                                                │                  │
                                                │ Returns:         │
                                                │ { accessToken,   │
                                                │   refreshToken } │
                                                └──────────────────┘
```

**Why anonymous tokens?** Even unauthenticated users need some form of token to access certain public APIs (e.g., browsing catalogue). The anonymous token has a `userId` of `'anonymous'` and minimal scopes, so the downstream services can still enforce basic authorization while allowing limited access.

### 3.4 Custom Payload Token (POST /v1/token)

```
┌──────────┐   POST /auth/apis/v1/token          ┌──────────────┐
│ Internal │ ─────────────────────────────────▶   │  Auth Route  │
│ Service  │   Body: { custom payload }           └──────┬───────┘
└──────────┘                                             │
                                                         ▼
                                                ┌──────────────────┐
                                                │ AuthController   │
                                                │ .generateToken() │
                                                │                  │
                                                │ Directly signs   │
                                                │ whatever payload │
                                                │ is provided      │
                                                └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌──────────────────┐
                                                │ AuthService      │
                                                │ .issueToken()    │
                                                └──────────────────┘
```

**Why this exists:** This is an internal-facing endpoint used by other microservices to generate tokens with custom payloads (e.g., service-to-service communication tokens). It bypasses user lookup entirely.

---

## 4. Tech Stack

### 4.1 Core Technologies

| Technology | Version | Role | Why This Choice? |
|-----------|---------|------|-----------------|
| **Node.js** | 18.20.5 | Runtime | Non-blocking I/O ideal for a proxy/gateway service that mostly forwards requests. The event loop handles thousands of concurrent proxy connections efficiently. |
| **Express.js** | ^4.18.1 | HTTP Framework | The most mature Node.js framework. Middleware-based architecture aligns perfectly with the auth verification pipeline. |
| **MongoDB** | (via Mongoose ^6.10.0) | Database | Schema-flexible NoSQL DB suits the polymorphic user model (users can be retailers, household, logistics, admin with different data shapes). |
| **Mongoose** | ^6.10.0 | ODM | Provides schema validation, middleware hooks, and a clean API over raw MongoDB driver. `findById()` used extensively. |
| **JSON Web Tokens (JWT)** | ^8.5.1 (`jsonwebtoken`) | Authentication | Industry standard for stateless authentication. HS256 symmetric signing is simple and fast — no need for RSA when the same service signs and verifies. |
| **http-proxy-middleware** | ^2.0.6 | Reverse Proxy | Battle-tested middleware for proxying HTTP and WebSocket connections. Supports `changeOrigin`, WebSocket proxying (`ws: true`), and transparent forwarding. |
| **Axios** | ^1.3.4 | HTTP Client | Used for inter-service communication (calling RMS for shop data, calling LMS for logistics data). Promise-based with interceptor support. |

### 4.2 Supporting Libraries

| Library | Version | Purpose | Details |
|---------|---------|---------|---------|
| **bcrypt** | ^5.0.1 | Password Hashing | Present in dependencies but **not actively used** in the current codebase. Likely carried over from initial setup for potential password-based auth in the future. |
| **cors** | ^2.8.5 | Cross-Origin support | Allows browser-based clients (admin panel, etc.) to make requests from different origins. Applied with default config (all origins allowed). |
| **cuid** | ^3.0.0 | Collision-resistant IDs | Generates unique session IDs when no `sessionid` header is present. Used in CLS-hooked session tracking. |
| **dotenv** | ^16.0.1 | Environment Variables | Loads `.env` files for local development. In production, env vars are injected by Docker/Kubernetes. |
| **joi** | ^17.6.0 | Validation | Schema-based validation library. Validation schemas are defined but **not actively wired** into the auth routes (the `validationSchema` param is passed through but never applied). |
| **knex** | ^2.0.0 | SQL Query Builder | Present for legacy SQL database migration scripts. The service has **migrated to MongoDB**, so these scripts reference a non-existent `knex` configuration. |
| **module-alias** | ^2.2.2 | Path Aliases | Enables `@controllers`, `@services`, `@models`, `@config` imports instead of relative paths. Configured in `package.json` under `_moduleAliases`. |
| **moment** | ^2.29.3 | Date Manipulation | In dependencies but not actively imported in current code. Available for future date operations. |
| **morgan** | ^1.10.0 | HTTP Logger | Request logging middleware. Commented out in `server.js` in favor of `ReqLogger` from `sarvm-utility`. |
| **mysql** | ^2.18.1 | MySQL Driver | Legacy dependency from when the service used MySQL. **Not used** — the service now runs on MongoDB. |
| **objection** | ^3.0.1 | ORM (SQL) | Legacy dependency. Was used with Knex for SQL databases. **Not used** with current MongoDB setup. |
| **sarvm-utility** | v5.0.3 | Shared Utility Package | Private AWS CodeCommit package providing `Logger`, `ErrorHandler` (BaseError, INTERNAL_SERVER_ERROR, etc.), `AuthManager`, `ReqLogger`, `HttpResponseHandler`, and `apiServices` (inter-service API helpers like `getAllShopViaUserId`). This is the **glue library** that standardizes logging, error handling, and inter-service communication across all Sarvm microservices. |
| **swagger-ui-express** | ^4.6.0 | API Documentation | Serves the OpenAPI 3.0 specification at `/auth/apis/apidocs` as an interactive Swagger UI. |
| **uuid** | ^8.3.2 | UUID Generation | In dependencies but not actively imported. Available for generating unique identifiers. |

### 4.3 Development Dependencies

| Tool | Version | Purpose |
|------|---------|---------|
| **ESLint** | ^8.15.0 | Linting with Airbnb base style + Prettier integration |
| **Prettier** | ^2.6.2 | Code formatting (120 char width, single quotes, trailing commas) |
| **Nodemon** | ^2.0.16 | Auto-restart server on file changes during development |

### 4.4 External Shared Library: `sarvm-utility`

This is a critical dependency hosted on AWS CodeCommit (`git+https://...@git-codecommit.ap-south-1.amazonaws.com/v1/repos/node_utility#v5.0.3`). It exports:

- **`Logger`** — Structured logging (info, error, warn).
- **`ReqLogger`** — Express middleware that logs every incoming request with metadata.
- **`reqFormat`** — Morgan-compatible request formatter.
- **`ErrorHandler`** — Contains error class hierarchy:
  - `BaseError` — Base class for all errors.
  - `INTERNAL_SERVER_ERROR` — Generic 500 error.
  - `PAGE_NOT_FOUND_ERROR` — 404 error.
  - `ACCESSTOKEN_EXP_ERROR` — Access token expired error.
  - `REFRESHTOKEN_EXP_ERROR` — Refresh token expired error.
  - `UNAUTH_USER` — Unauthorized user error.
- **`AuthManager`** — From `sarvm-utility`, provides `decodeAuthToken` middleware (used globally in `server.js` and `InitApp`).
- **`HttpResponseHandler`** — Standardized success/error JSON response formatter.
- **`apiServices`** — Pre-built HTTP clients for inter-service calls:
  - `rms.getAllShopViaUserId()` — Calls Retailer Management Service to fetch shop data.

**Why a shared library?** All five microservices need identical error handling, logging formats, and inter-service communication patterns. The shared library ensures consistency and avoids code duplication.

---

## 5. Project Structure

### 5.1 Complete File Tree

```
auth_service/
├── .dev.env                          # Development environment variables
├── .dockerignore                     # Files excluded from Docker context
├── .env.example                      # Template for environment variables
├── .eslintignore                     # ESLint ignore patterns
├── .eslintrc.json                    # ESLint configuration (Airbnb + Prettier)
├── .gitignore                        # Git ignore patterns
├── .lcl.env                          # Local environment variables
├── .prd.env                          # Production environment variables
├── .prettierignore                   # Prettier ignore patterns
├── .prettierrc                       # Prettier formatting config
├── .stg.env                          # Staging environment variables
├── Dockerfile                        # Production Docker build (node:18.20.5)
├── Dockerfile.dev                    # Development Docker build (ECR image)
├── Dockerfile.staging                # Staging Docker build (ECR image)
├── README.md                         # Mermaid diagram link
├── jsconfig.json                     # VS Code path alias resolution
├── package.json                      # Dependencies + scripts + module aliases
├── package-lock.json                 # Locked dependency versions
├── server.js                         # ★ APPLICATION ENTRY POINT
│
└── src/
    ├── InitApp/
    │   └── index.js                  # ★ Application initialization (DB, middleware, sessions)
    │
    ├── apis/
    │   ├── controllers/
    │   │   └── v1/
    │   │       ├── Auth.js           # ★ Core business logic (token generation, user lookup)
    │   │       └── index.js          # Exports AuthController
    │   │
    │   ├── services/
    │   │   └── v1/
    │   │       ├── Auth.js           # ★ Token issuance/verification wrappers
    │   │       ├── Logistic/
    │   │       │   └── index.js      # ★ Logistics service integration (calls LMS API)
    │   │       └── index.js          # Exports AuthService
    │   │
    │   ├── routes/
    │   │   ├── index.js              # ★ Main router (healthcheck, apidocs, v1 routes)
    │   │   └── v1/
    │   │       ├── Auth.js           # ★ Auth API route definitions
    │   │       └── index.js          # Mounts Auth router
    │   │
    │   ├── models/
    │   │   └── Users.js              # ★ Mongoose User schema
    │   │
    │   └── db/
    │       └── index.js              # ★ MongoDB connection singleton
    │
    ├── common/
    │   ├── helper/
    │   │   └── index.js              # Exports AccessEnv (duplicate of utility)
    │   │
    │   ├── libs/
    │   │   ├── AuthManager/
    │   │   │   └── index.js          # ★ JWT signing, verification, decoding, scope checking
    │   │   │
    │   │   ├── ErrorHandler/
    │   │   │   ├── index.js          # ★ AppError class with centralized error handling
    │   │   │   └── reqToCurl.js      # Converts Express request to cURL for debugging
    │   │   │
    │   │   ├── Logger/
    │   │   │   └── all-the-logs.log  # Log output file
    │   │   │
    │   │   ├── Validation/
    │   │   │   ├── Schemas.js        # Joi validation schemas (user schema)
    │   │   │   └── Validation.js     # Validation middleware factory
    │   │   │
    │   │   ├── HttpResponseHandler.js # Standardized success/error JSON responses
    │   │   ├── Logger.js             # Exports console as Logger (fallback)
    │   │   ├── RequestHandler.js     # Axios-based HTTP client (singleton, for internal requests)
    │   │   ├── authorization.js      # Legacy JWT helper (hardcoded keys, not used)
    │   │   └── index.js              # Exports: Logger, RequestHandler, HttpResponseHandler, AuthManager
    │   │
    │   └── utility/
    │       ├── AccessEnv.js          # ★ Environment variable accessor with caching
    │       └── index.js              # Exports AccessEnv
    │
    ├── config/
    │   └── index.js                  # ★ Centralized configuration (env vars → structured config object)
    │
    ├── constants/
    │   ├── index.js                  # Aggregates all error constants
    │   └── errorConstants/
    │       ├── index.js              # Merges auth, OTP, server error constants
    │       ├── authErrors.js         # Auth error codes + messages + HTTP status codes
    │       ├── otpErrors.js          # OTP error codes (SEND_OTP_ERROR, VERIFY_OTP_ERROR)
    │       └── serverErrors.js       # Server error codes (500, 404, 400)
    │
    ├── openapi/
    │   └── openapi.json              # OpenAPI 3.0 specification
    │
    └── scripts/
        ├── migrateLatest.js          # Knex migration runner (legacy, SQL)
        ├── migrateMake.js            # Knex migration maker (legacy, SQL)
        └── migrateRollback.js        # Knex migration rollback (legacy, SQL)
```

### 5.2 Path Aliases

Defined in `package.json` under `_moduleAliases` and registered via `module-alias/register`:

| Alias | Maps To | Usage |
|-------|---------|-------|
| `@root` | `.` (project root) | Access root-level files |
| `@controllers` | `src/apis/controllers` | `require('@controllers/v1')` |
| `@services` | `src/apis/services` | `require('@services/v1')` |
| `@db` | `src/apis/db` | `require('@db')` |
| `@models` | `src/apis/models` | `require('@models/Users')` |
| `@routes` | `src/apis/routes` | `require('@routes')` |
| `@constants` | `src/constants` | `require('@constants')` |
| `@config` | `src/config` | `require('@config')` |
| `@common` | `src/common` | `require('@common/libs')` |

**Why aliases?** Deeply nested files would require ugly relative paths like `../../../common/libs/AuthManager`. Aliases make imports clean, readable, and resistant to refactoring (moving files doesn't break imports).

The `jsconfig.json` mirrors these aliases so VS Code / IDEs can resolve them for IntelliSense and navigation.

---

## 6. Core Functionality

### 6.1 JWT Token System

The auth service uses **HS256 (HMAC-SHA256)** symmetric JWT tokens. This means the same secret key (`HS256_TOKEN_SECRET`) is used for both signing (creating) and verifying tokens.

#### 6.1.1 Access Token

| Property | Value | Why? |
|----------|-------|------|
| **Algorithm** | HS256 | Symmetric signing — fast, simple, single-service verification. No need for RSA since only the auth service signs tokens and all verification happens here. |
| **Subject** | `accessToken` | Identifies token type so the decode middleware knows which error to throw on expiry. |
| **Issuer** | `sarvm:ums` | Identifies the token issuer for validation purposes. |
| **notBefore** | `120ms` | Token becomes valid 120ms after creation. This microchipped delay prevents race conditions where a token is used before the signing process fully completes across distributed systems. |
| **expiresIn** | Configurable (env: `ACCESS_TOKEN_EXPIRESIN`, default: `365d` in example) | Short-lived in production, long-lived in development for convenience. |

**Access Token Payload (varies by app):**

For **Retailer App**:
```json
{
  "entityType": "SU",
  "entityId": "<shopId>",
  "userId": "<mongoId>",
  "phone": "<phone>",
  "userType": "RETAILER",
  "shopId": "<shopId>",
  "shopUniqueId": "<shopResourceId>",
  "isEmployee": false,
  "shopMeta": {
    "shop": { "shop_id": "...", "id": "...", "...full shop object..." },
    "flag": {
      "onBoarding": true,
      "isSubscribed": true,
      "GST_no": true,
      "isKYCVerified": true
    }
  },
  "segmentId": "retailer",
  "flyyUserId": "retailer-<flyyUserId>",
  "scope": ["Users", "retailerApp"]
}
```

For **Logistics Delivery App**:
```json
{
  "entityType": "LU",
  "entityId": "<userId>",
  "userId": "<mongoId>",
  "phone": "<phone>",
  "onbording": true,
  "subscribed": true,
  "userType": "LOGISTICS_DELIVERY",
  "segmentId": "logistics_delivery",
  "flyyUserId": "logisticsDelive-<flyyUserId>",
  "isEmployee": false,
  "scope": ["Users", "logisticsDelivery"]
}
```

For **Admin Panel**:
```json
{
  "userId": "<mongoId>",
  "phone": "<phone>",
  "userType": "ADMIN",
  "adminData": { "status": "active", "role": "super_admin" },
  "segmentId": "super_admin",
  "flyyUserId": "adm-<flyyUserId>",
  "scope": ["ADMIN"]
}
```

For **Household App / General**:
```json
{
  "userId": "<mongoId>",
  "phone": "<phone>",
  "userType": "HOUSEHOLD",
  "segmentId": "household",
  "flyyUserId": "household-<flyyUserId>",
  "isEmployee": false,
  "scope": ["Users", "householdApp"]
}
```

**Why different payloads?** Each client application needs different data embedded in the token. Downstream services decode the token and use these fields for authorization decisions, personalization, and business logic without making additional database queries.

#### 6.1.2 Refresh Token

| Property | Value |
|----------|-------|
| **Algorithm** | HS256 |
| **Subject** | `refreshToken` |
| **Payload** | `{ userId, scope: [] }` (minimal — only userId, empty scope) |
| **expiresIn** | Configurable (env: `REFRESH_TOKEN_EXPIRESIN`) |

**Why is the refresh token payload minimal?** The refresh token is only used to obtain a new access token. It doesn't need the full payload because when it's used, the service will re-fetch the user data from MongoDB and generate a fresh access token with up-to-date information.

#### 6.1.3 Token Issuance Response

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "body": {}
}
```

For **logistics delivery** users, the `body` also includes:
```json
{
  "body": {
    "onbording": true,
    "subscribed": true
  }
}
```

**Why include `body` for logistics?** The logistics delivery app needs immediate access to onboarding and subscription status to determine UI navigation (whether to show the onboarding flow or the main app).

### 6.2 Token Verification

The `AuthManager.verifyToken()` method (in `src/common/libs/AuthManager/index.js`) uses `jwt.verify()` with the shared secret. If verification fails (expired, tampered, wrong secret), it throws an error that propagates up through the error handler.

### 6.3 Token Decoding Middleware

`AuthManager.decodeAuthToken` is an Express middleware applied globally. On every request:

1. Extract `Authorization` header → split into `jwtSubject` (first part) and `jwtToken` (second part).
2. If no token is present, call `next()` (allow unauthenticated requests to proceed — they'll be caught by route-level auth checks if needed).
3. If a token exists, `jwt.verify()` it:
   - If **valid**: attach decoded payload to `req.authPayload` and call `next()`.
   - If **invalid** and subject is `accessToken`: throw `ACCESSTOKEN_EXP_ERROR`.
   - If **invalid** and subject is `refreshToken`: throw `REFRESHTOKEN_EXP_ERROR`.
4. Also validates that `decoded.sub` matches `jwtSubject` to prevent token type confusion (using an access token where a refresh token is expected).

### 6.4 Scope-Based Authorization

`AuthManager.requiresScopes(scopes)` is a middleware factory:

```javascript
// Usage example (not directly used in auth routes but available):
router.get('/protected', AuthManager.requiresScopes(['ADMIN']), handler);
```

**How it works:**
1. Check if `req.authPayload` exists (decoded token).
2. Extract `scope` array from the payload.
3. Find intersection between request scopes and required scopes.
4. If intersection is non-empty → authorized, call `next()`.
5. If empty → throw `UNAUTH_USER` error.

**Why scope-based?** Different apps and user types need different levels of access. The `scope` field in the JWT payload contains values like `['Users', 'retailerApp']` or `['ADMIN']`, enabling fine-grained access control without database lookups.

### 6.5 User Segmentation

The `getSegment()` function in the Auth Controller determines the **user segment** based on `app_name` and `userType`. This is used for analytics, feature flags, and the Flyy rewards platform.

| App Name | User Type | Segment ID |
|----------|-----------|------------|
| `retailerApp` | * | `retailer` |
| `householdApp` | `EMPLOYEE_SH` | `sales_employee_sh` |
| `householdApp` | `EMPLOYEE_SSO` | `sales_employee_sso` |
| `householdApp` | `EMPLOYEE_CO` | `sales_employee_co` |
| `householdApp` | * (others) | `household` |
| `logisticsDelivery` | * | `logistics_delivery` |
| `admin` | active | `<user's admin role>` (e.g., `super_admin`) |
| `admin` | inactive | `non-admin` |

### 6.6 User Type Mapping

The `getUserType()` function maps `app_name` to a standardized user type string:

| App Name | Mapped User Type |
|----------|-----------------|
| `retailerApp` | `RETAILER` |
| `logisticsDelivery` | `LOGISTICS_DELIVERY` |
| `admin` | `ADMIN` |
| Others | Original `userType` from DB (e.g., `HOUSEHOLD`, `EMPLOYEE_SH`) |

### 6.7 Flyy User ID Construction

The `flyyUserId` field is constructed as: `{app_name_prefix}-{flyyUserId_from_db}`

The prefix is derived from `app_name.slice(0, -3)`:
- `retailerApp` → `retailer` (removes `App`)
- `householdApp` → `household` (removes `App`)
- `logisticsDelivery` → `logisticsDelive` (removes `ery`)
- `admin` → `adm` (removes `in`)

**Why?** The Flyy rewards platform requires a unique user identifier per-app. The prefix ensures that the same user using two different apps gets two different Flyy profiles.

---

## 7. APIs & Integrations

### 7.1 Auth Service REST API Endpoints

All routes are prefixed with `/{HOST_SERVICE_NAME}/apis` where `HOST_SERVICE_NAME` = `auth`, resulting in base path: `/auth/apis`.

#### 7.1.1 `GET /auth/apis/healthcheck`

| Property | Value |
|----------|-------|
| **Purpose** | Liveness/readiness probe for load balancers and orchestrators |
| **Authentication** | None required |
| **Request Headers** | None required |
| **Request Body** | None |
| **Response** | `{ "success": true, "data": { "ts": "2026-04-11T...", "buildNumber": "101" } }` |
| **HTTP Status** | 200 |

**Why it exists:** Kubernetes, Docker Compose, and AWS ALB use health check endpoints to determine if the service is alive. If this endpoint stops responding, the container is restarted.

**How it works:**
1. Router catches `GET /healthcheck`.
2. Returns current timestamp and build number (from `BUILD_NUMBER` env var).
3. Uses `HttpResponseHandler.success()` for consistent response format.

---

#### 7.1.2 `GET /auth/apis/v1/token/:userId`

| Property | Value |
|----------|-------|
| **Purpose** | Generate access + refresh tokens for an authenticated user |
| **Authentication** | Requires existing valid token (chicken-and-egg: used after OTP verification by user_mgmt_service) |
| **Request Headers** | `app_name` (string, required), `app_version_code` (integer, required), `Authorization` (Bearer token) |
| **Path Parameters** | `userId` (MongoDB ObjectId) |
| **Request Body** | None |
| **Response** | `{ "success": true, "data": { "accessToken": "...", "refreshToken": "...", "body": {} } }` |
| **HTTP Status** | 200 |

**Detailed flow:**

1. **Route** (`routes/v1/Auth.js`):
   - `handleRESTReq` extracts `app_name`, `app_version_code`, `authorization` from headers and `userId` from params.
   - Bundles everything into `dataValues` object.
   - Calls `AuthController.getToken(dataValues)`.

2. **Controller** (`controllers/v1/Auth.js` → `getToken()`):
   - Gets the `Users` model from the DB singleton.
   - Calls `Users.findById(userId)` to fetch the user from MongoDB.
   - If user is `null` or `undefined` → throws `INTERNAL_SERVER_ERROR('user does not exists')`.
   - Builds headers and body for potential inter-service calls.
   - **Branches based on `app_name`:**
     - `retailerApp` → `generateRetailerData()`:
       - Calls `apiServices.rms.getAllShopViaUserId({ headers, body })` → HTTP request to Retailer Management Service to get shop data.
       - Processes shop data: extracts `shop_id`, `id`, `isKYCVerified`, `isSubscribed`, `GST_no`.
       - Computes flags: `onBoarding` (true if KYC verified AND subscribed), `GST_no` (true if not null).
       - Builds payload with `entityType: 'SU'`, shop metadata, segment, and scope.
     - `logisticsDelivery` → `generateLogisticData()`:
       - Calls `logisticInformation(userId)` → HTTP GET to `{INTERNAL_LOAD_BALANCER}/lms/apis/v1/profile/{userId}` to get delivery profile.
       - Extracts `onbording` and `subscribed` flags.
       - Builds payload with `entityType: 'LU'`, logistics metadata.
     - `admin` → `generateAdminData()`:
       - Accesses `user._doc.adminData` for admin status and role.
       - Builds payload with `scope: ['ADMIN']`.
     - Everything else → `generateGeneralData()`:
       - Basic payload with user phone, type, segment.
   - Passes the assembled payload to `AuthService.issueToken()`.

3. **Service** (`services/v1/Auth.js` → `issueToken()`):
   - Calls `AuthManager.issueTokens(payload)`.

4. **AuthManager** (`common/libs/AuthManager/index.js` → `issueTokens()`):
   - Validates payload is not null/undefined.
   - Signs the **access token** with full payload using `jwt.sign()` (HS256, configured expiration).
   - Signs the **refresh token** with minimal payload (`{ userId, scope: [] }`).
   - If `scope[1] === 'logisticsDelivery'`, includes `{ onbording, subscribed }` in `body`.
   - Returns frozen object: `{ accessToken, refreshToken, body }`.

5. **Response** via `HttpResponseHandler.success()`.

---

#### 7.1.3 `GET /auth/apis/v1/unauth_token`

| Property | Value |
|----------|-------|
| **Purpose** | Generate anonymous token for unauthenticated users |
| **Authentication** | None required |
| **Request Headers** | `app_name` (string, required), `app_version_code` (integer, required) |
| **Request Body** | None |
| **Response** | `{ "success": true, "data": { "accessToken": "...", "refreshToken": "...", "body": {} } }` |
| **HTTP Status** | 200 |

**Detailed flow:**

1. **Route** extracts `app_name` and `app_version_code` from headers.
2. **Controller** (`getUnauthorizeToken()`):
   - Creates payload: `{ userId: 'anonymous', scope: [app_name] }`.
   - No database lookup — anonymous users don't exist in MongoDB.
   - Calls `AuthService.issueToken(payload)`.
3. Token is signed and returned.

**Use case:** Before a user logs in (OTP verification), the client app needs a token to access public endpoints (catalogue browsing, etc.). The anonymous token has `userId: 'anonymous'` which downstream services can check to apply restrictions.

---

#### 7.1.4 `POST /auth/apis/v1/token`

| Property | Value |
|----------|-------|
| **Purpose** | Generate token with custom payload (internal service use) |
| **Authentication** | Depends on proxy middleware |
| **Request Headers** | Standard headers |
| **Request Body** | Custom JSON payload to be signed |
| **Response** | `{ "success": true, "data": { "accessToken": "...", "refreshToken": "...", "body": {} } }` |

**Detailed flow:**

1. **Route** passes request body as the payload.
2. **Controller** (`generateToken()`):
   - Arrow function: `async (payload) => AuthService.issueToken(payload)`.
   - No validation, no user lookup — direct signing.
3. Token signed with whatever payload was provided.

**Why no validation?** This is an internal endpoint — other microservices call it when they need to issue tokens programmatically. Security is enforced at the network level (internal load balancer is not publicly accessible).

---

#### 7.1.5 `GET /auth/apis/apidocs`

| Property | Value |
|----------|-------|
| **Purpose** | Interactive Swagger UI for API documentation |
| **Authentication** | None |
| **Response** | HTML page (Swagger UI) |

**How:** Mounted via `swagger-ui-express` using the OpenAPI 3.0 spec at `src/openapi/openapi.json`.

The OpenAPI spec documents three endpoints:
- `GET /auth/apis/v1/token/{userId}` — with `userId` (path), `app_name` (header), `app_version_code` (header) parameters.
- `GET /auth/apis/v1/unauth_token` — with `app_name` and `app_version_code` headers.
- `GET /auth/apis/healthcheck` — with `app_name` and `app_version_code` headers.

Servers listed:
- Local: `http://localhost:3200/`
- Production: `https://api.sarvm.ai/`
- Staging: `https://uat-api.sarvm.ai/`

---

### 7.2 Outbound API Calls (Inter-Service Communication)

#### 7.2.1 Retailer Management Service (RMS)

| Property | Value |
|----------|-------|
| **Called By** | `AuthController.generateRetailerData()` |
| **Function** | `apiServices.rms.getAllShopViaUserId({ headers, body })` |
| **Source** | `sarvm-utility` package |
| **Purpose** | Fetch shop data for a retailer user |
| **When** | During token generation for `retailerApp` |
| **Input** | `headers` (Content-Type, app_name, app_version_code, Authorization), `body` ({ userId }) |
| **Response** | `{ success: true, data: [{ shop_id, id, isKYCVerified, isSubscribed, GST_no, ... }] }` |

**Why:** Retailer tokens need shop information embedded (shopId, KYC status, subscription status) so downstream services can make business decisions without querying the shop database on every request.

**What happens with the response:**
- If `success === true` and `data.length > 0`:
  - `shopId` = `data[0].shop_id`
  - `shopUniqueId` = `data[0].id`
  - `shopMeta.shop` = full shop object
  - Flags computed: `isKYCVerified`, `isSubscribed`, `onBoarding` (KYC + subscribed), `GST_no`
- If no shop exists: all shop fields remain `null`, all flags are `false`.

#### 7.2.2 Logistics Management Service (LMS)

| Property | Value |
|----------|-------|
| **Called By** | `logisticInformation()` in `services/v1/Logistic/index.js` |
| **HTTP Method** | `GET` |
| **URL** | `{INTERNAL_LOAD_BALANCER}/lms/apis/v1/profile/{userId}` |
| **Source** | Direct `axios` call |
| **Purpose** | Fetch logistics delivery profile for onboarding/subscription status |
| **When** | During token generation for `logisticsDelivery` app |
| **Response** | `{ data: { deliveryData: { onbording: true, subscribed: true } } }` |

**Why:** Logistics delivery tokens need to include onboarding and subscription status. The mobile app uses these values from the JWT (without additional API calls) to decide whether to show the onboarding wizard or the main delivery screen.

### 7.3 Proxy Routes

#### 7.3.1 `/whs` (Webhook Service Proxy)

```javascript
app.use('/whs', createProxyMiddleware(options));
```

- **No authentication check** — mounted directly as middleware.
- Proxies to `INTERNAL_LOAD_BALANCER`.
- Supports WebSocket (`ws: true`).

**Why no auth?** Webhooks come from external services (payment gateways, notification services) that don't have Sarvm JWT tokens. The `/whs` prefix is a dedicated path that bypasses the auth verification.

#### 7.3.2 `app.all('*')` (Catch-All Gateway Proxy)

```javascript
app.all('*', verifyTokenMiddleware, createProxyMiddleware(options));
```

- **Authentication required** — `verifyToken()` is called first.
- Catches ALL remaining routes not handled by the auth service's own routes.
- Proxies to `INTERNAL_LOAD_BALANCER` with `changeOrigin: true` and `ws: true`.

This is the **core gateway behavior** — every request to any microservice passes through here.

---

## 8. Database Design

### 8.1 Database Technology

- **Engine:** MongoDB
- **ODM:** Mongoose ^6.10.0
- **Connection:** Via `MONGO_URL` environment variable
- **Options:** `useNewUrlParser: true`, `useUnifiedTopology: true`, `strictQuery: true`

### 8.2 Connection Management

The `db` class (`src/apis/db/index.js`) implements the **Singleton Pattern**:

```javascript
class db {
  constructor() {
    if (!db.instance) {
      db.instance = this;
    }
    return db.instance;
  }

  connect() {
    mongoose.connect(url, options);
    this.Users = UserModel;
  }

  static getInstance() {
    return this.instance;
  }
}
```

**Why Singleton?** MongoDB connections are expensive to create. A single shared connection pool is used across all requests. The singleton ensures that `new db()` returns the same instance every time, and `db.getInstance()` provides static access to the connected instance and its models.

### 8.3 User Schema

**Collection:** `users` (Mongoose auto-pluralizes model name `User` → `users`)

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
    kycDetails: {
      kycId:                  String,
    },
    transactionDetails: {
      transactionDetailsId:   String,
    },
  },
  retailerData:   {},    // Flexible sub-document
  deliveryData:   {},    // Flexible sub-document
  householdData:  {},    // Flexible sub-document
});
```

#### 8.3.1 Field Details

| Field | Type | Required | Unique | Description |
|-------|------|----------|--------|-------------|
| `_id` | ObjectId | Auto | Yes | MongoDB auto-generated primary key. Used as `userId` throughout the system. |
| `username` | String | No | No | Display name of the user. Not required — many users register with phone only. |
| `phone` | String | **Yes** | **Yes** | Primary identifier for OTP-based authentication. Unique index ensures one user per phone number. |
| `refreshTokenTimestamp` | Number | **Yes** | No | Unix timestamp (seconds). Default: creation time. Used for token invalidation — if a user's refresh token timestamp is newer than the token's, the token is considered revoked. |
| `basicInformation.personalDetails` | Object | No | No | Nested personal info: first name, last name, father's name, DOB, gender, secondary mobile, email. |
| `basicInformation.kycDetails` | Object | No | No | KYC (Know Your Customer) verification reference. Contains `kycId`. |
| `basicInformation.transactionDetails` | Object | No | No | Transaction information reference. Contains `transactionDetailsId`. |
| `retailerData` | Object (flexible) | No | No | Stores retailer-specific data. Schema-less `{}` allows any structure. |
| `deliveryData` | Object (flexible) | No | No | Stores delivery/logistics-specific data. Schema-less `{}`. |
| `householdData` | Object (flexible) | No | No | Stores household/consumer-specific data. Schema-less `{}`. |

**Implicit fields from code (not in schema but accessed):**
- `userType`: String indicating user type (`RETAILER`, `HOUSEHOLD`, `EMPLOYEE_SH`, `EMPLOYEE_SSO`, `EMPLOYEE_CO`, `ADMIN`, `LOGISTICS_DELIVERY`). This field is stored in MongoDB but not defined in the Mongoose schema (Mongoose's `strictQuery: true` still allows reading it, just not filtering by it strictly).
- `flyyUserId`: String used for Flyy rewards integration.
- `adminData`: Object with `{ status, role }` for admin users.

**Why schema-less sub-documents?** The `retailerData`, `deliveryData`, and `householdData` are empty object schemas (`{}`). This is because the auth service is **not the owner** of these data structures — the respective microservices (retailer_service, etc.) manage them. The auth_service only reads them during token generation. Making them schema-less avoids the need to update the auth service schema every time a downstream service changes its data model.

### 8.4 Database Operations in Auth Service

The auth service performs very few database operations:

| Operation | Method | Location | When |
|-----------|--------|----------|------|
| Lookup user by ID | `Users.findById(userId)` | `AuthController.getToken()` | During token generation (GET `/v1/token/:userId`) |

**That's it.** The auth service does **no writes** to the database. It is a **read-only consumer** of user data. User creation, updates, and deletion are handled by the `user_mgmt_service`.

### 8.5 Legacy Database Artifacts

The codebase contains remnants of a previous SQL (MySQL) database setup:

- **`knex`** and **`objection`** in `package.json` — SQL query builder and ORM.
- **`mysql`** driver in `package.json`.
- **Migration scripts** in `src/scripts/` (`migrateLatest.js`, `migrateMake.js`, `migrateRollback.js`) — reference `../knex/knex` which doesn't exist.
- **Commented-out SQL config** in `src/config/index.js` (DB_HOST, DB_USER, DB_PASSWORD, DB_PORT).

The service was originally built with MySQL and later migrated to MongoDB. These artifacts remain but are non-functional.

---

## 9. Setup & Installation

### 9.1 Prerequisites

- **Node.js** v18.20.5+ (matches Docker image)
- **MongoDB** instance (local or Atlas)
- **Access to AWS CodeCommit** (for `sarvm-utility` package — requires credentials embedded in the package.json URL)
- **npm** (comes with Node.js)

### 9.2 Environment Setup

1. **Copy the example env file:**
   ```bash
   cp .env.example .lcl.env
   ```

2. **Configure environment variables in `.lcl.env`:**

   | Variable | Description | Example |
   |----------|-------------|---------|
   | `NODE_ENV` | Runtime environment | `development` |
   | `ENV` | Environment name | `dev` |
   | `BUILD_NUMBER` | Build identifier | `101` |
   | `HOST` | Server host | `localhost` |
   | `HOST_PORT` | Server port | `3200` |
   | `HOST_SERVICE_NAME` | Service name (used in URL prefix) | `auth` |
   | `MONGO_URL` | Full MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/dbname` |
   | `HS256_TOKEN_SECRET` | JWT signing secret | `sarvm` (change in production!) |
   | `ACCESS_TOKEN_EXPIRESIN` | Access token lifespan | `365d` (dev), `1h` (prod) |
   | `REFRESH_TOKEN_EXPIRESIN` | Refresh token lifespan | `365d` (dev), `30d` (prod) |
   | `INTERNAL_LOAD_BALANCER` | URL of internal load balancer | `http://localhost:1207` |
   | `SESSION_NAME` | CLS session namespace name | `logger_session` |

### 9.3 Installation

```bash
# Clone the repository
git clone <repo-url>
cd backend/auth_service

# Install dependencies (requires AWS CodeCommit access for sarvm-utility)
npm install
```

### 9.4 Running the Service

| Command | Description | Environment |
|---------|-------------|-------------|
| `npm run lcl` | Run with `.lcl.env` (local development) | Local |
| `npm run lcl:dev` | Run with `.dev.env` | Dev |
| `npm run lcl:stg` | Run with `.stg.env` | Staging |
| `npm run lcl:prd` | Run with `.prd.env` | Production |
| `npm run prd` | Run for production (no dotenv) | Production (Docker) |
| `npm run stg` | Run for staging (no dotenv) | Staging (Docker) |

All commands use **nodemon** for hot-reloading. The `lcl*` variants use `dotenv/config` to load env files; `prd` and `stg` expect environment variables to be injected by the container runtime.

### 9.5 Docker Deployment

Three Dockerfiles exist for different environments:

| Dockerfile | Base Image | Environment |
|-----------|-----------|-------------|
| `Dockerfile` | `node:18.20.5` / `node:18.20.5-alpine` | Production |
| `Dockerfile.dev` | ECR `node:17.9.1` / `node:17.9.1-alpine` | Development |
| `Dockerfile.staging` | ECR `node:17.9.1` / `node:17.9.1-alpine` | Staging |

**Multi-stage build:**
1. **Build stage:** Full Node.js image → installs dependencies with `npm ci` (production-only for prod Dockerfile).
2. **Production stage:** Alpine image → copies built `node_modules` and source code. Much smaller final image.

**Build:**
```bash
docker build -t auth-service --build-arg BUILD_NUMBER=101 .
```

**Run:**
```bash
docker run -p 3200:3200 \
  -e MONGO_URL=mongodb://... \
  -e HS256_TOKEN_SECRET=secret \
  -e INTERNAL_LOAD_BALANCER=http://lb:80 \
  auth-service
```

**Port exposed:** `3200`
**Log volume:** `/usr/src/logs`

### 9.6 Accessing API Documentation

After starting the service, visit:
```
http://localhost:3200/auth/apis/apidocs
```

This opens the interactive Swagger UI with all documented endpoints.

---

## 10. User Flow

### 10.1 Complete User Journey: Retailer App Login

```
Step 1: ANONYMOUS ACCESS
═══════════════════════════
User opens the Retailer App for the first time.
App has no tokens yet.

   App ──▶ GET /auth/apis/v1/unauth_token
           Headers: { app_name: 'retailerApp', app_version_code: 101 }
   
   ◀── Response: { accessToken: '<anon_token>', refreshToken: '<anon_refresh>' }
   
   App stores both tokens in secure storage.
   All subsequent requests use the anonymous access token.

Step 2: OTP REQUEST (via User Management Service)
═══════════════════════════════════════════════════
User enters phone number to login.

   App ──▶ POST /ums/apis/v1/auth/send-otp
           Headers: { Authorization: 'accessToken <anon_token>' }
           Body: { phone: '9876543210' }
   
   Auth Service: verifies anon_token ✓ → proxies to Internal LB → UMS
   
   UMS sends OTP via SMS gateway.

Step 3: OTP VERIFICATION (via User Management Service)
══════════════════════════════════════════════════════
User enters the received OTP.

   App ──▶ POST /ums/apis/v1/auth/verify-otp
           Headers: { Authorization: 'accessToken <anon_token>' }
           Body: { phone: '9876543210', otp: '123456' }
   
   Auth Service: verifies anon_token ✓ → proxies to Internal LB → UMS
   
   UMS verifies OTP → creates/finds User in MongoDB → returns userId.

Step 4: TOKEN GENERATION
════════════════════════
UMS (or App) calls auth service to get authenticated tokens.

   App/UMS ──▶ GET /auth/apis/v1/token/63300cb5ea6a3078062a23fc
               Headers: { app_name: 'retailerApp', app_version_code: 101,
                          Authorization: 'accessToken <existing_token>' }
   
   Auth Service:
   ├── Looks up user in MongoDB by userId
   ├── Calls RMS API to get shop data
   ├── Generates retailer-specific payload
   ├── Signs access token (with full payload)
   ├── Signs refresh token (with userId only)
   └── Returns { accessToken, refreshToken, body }
   
   App stores new tokens, discards old ones.

Step 5: AUTHENTICATED API CALLS
════════════════════════════════
User browses products, places orders, etc.

   App ──▶ GET /cms/apis/v1/products?category=dairy
           Headers: { Authorization: 'accessToken <auth_token>' }
   
   Auth Service:
   ├── decodeAuthToken middleware: decodes JWT → req.authPayload
   ├── Route match: none (not /auth/apis/*)
   ├── Catch-all: app.all('*')
   │   ├── Extract headers + body
   │   ├── AuthController.verifyToken() → jwt.verify() ✓
   │   └── next() → proxy to Internal LB
   └── createProxyMiddleware → forwards to Catalogue Service
   
   Catalogue Service processes request and responds.

Step 6: TOKEN EXPIRY & REFRESH
═════════════════════════════
Access token expires (based on ACCESS_TOKEN_EXPIRESIN).

   App ──▶ ANY REQUEST
           Headers: { Authorization: 'accessToken <expired_token>' }
   
   Auth Service:
   ├── decodeAuthToken: jwt.verify() fails
   ├── Error: ACCESSTOKEN_EXP_ERROR
   └── Response: { success: false, error: { code: 'ACCESSTOKEN_EXP_ERROR', message: 'Access Token expired' } }
   
   App detects expired token → uses refresh token to get new tokens.
   
   App ──▶ GET /auth/apis/v1/token/<userId>
           Headers: { Authorization: 'refreshToken <refresh_token>', app_name: '...' }
   
   Auth Service generates fresh tokens.
   App stores new tokens.
```

### 10.2 Complete User Journey: Admin Panel Login

```
Step 1: Admin accesses the admin panel web app
Step 2: Enters phone → OTP flow (same as above)
Step 3: Token generation with app_name: 'admin'
   ├── User lookup from MongoDB
   ├── Checks user.adminData.status
   │   ├── if 'active' → segmentId = user.adminData.role
   │   └── if not 'active' → segmentId = 'non-admin'
   ├── scope = ['ADMIN']
   └── Token issued
Step 4: Admin makes API calls
   ├── All requests go through auth gateway
   ├── Token verified
   └── Proxied to respective service
```

### 10.3 Complete User Journey: Logistics Delivery

```
Step 1: Driver opens the Logistics Delivery App
Step 2: Anonymous token (app_name: 'logisticsDelivery')
Step 3: OTP login flow
Step 4: Token generation with app_name: 'logisticsDelivery'
   ├── User lookup from MongoDB
   ├── Calls LMS API: GET /lms/apis/v1/profile/{userId}
   ├── Gets deliveryData: { onbording, subscribed }
   ├── If deliveryData is null → both flags = false
   ├── entityType = 'LU' (Logistics User)
   ├── Token signed with onboarding/subscription status
   └── Response includes body: { onbording, subscribed }
Step 5: App checks body.onbording
   ├── if false → show onboarding wizard
   └── if true → show main delivery screen
```

---

## 11. Edge Cases & Limitations

### 11.1 Known Edge Cases

| # | Scenario | Current Behavior | Impact |
|---|----------|-----------------|--------|
| 1 | **User doesn't exist in MongoDB** (invalid userId) | `Users.findById()` returns `null` → throws `INTERNAL_SERVER_ERROR('user does not exists')` | Client sees a generic 500 error. Should be a 404 or 400 with a specific error code. |
| 2 | **Missing `app_name` header** | `getSegment()` reaches the final `throw new INTERNAL_SERVER_ERROR()` because no condition matches | Generic 500 error. Should validate header upfront. |
| 3 | **Unknown `app_name` value** | Falls through to `generateGeneralData()` (the else branch) | Works correctly but may produce unexpected segment/userType for new apps not yet handled. |
| 4 | **RMS API fails or is unreachable** | `getAllShopViaUserId()` throws → `generateRetailerData()` throws → 500 error | Token generation fails entirely. No fallback to issue a token without shop data. |
| 5 | **LMS API fails or is unreachable** | `axios(config)` throws → `logisticInformation()` throws `INTERNAL_SERVER_ERROR` | Logistics token generation fails. No fallback. |
| 6 | **User has no shop** (new retailer, no shop created yet) | `shopApiResponse.data.length === 0` → all shop fields are `null`, all flags are `false` | Token is issued with null shopId — downstream services must handle this gracefully. |
| 7 | **Multiple shops for one user** | Only `data[0]` is used | Multi-shop users only get the first shop in their token. Other shops are ignored. |
| 8 | **Middleware duplication** | `decodeAuthToken`, `cors()`, `urlencoded()` applied in both `InitApp` and `server.js` | Each request processes these middlewares twice. No functional issue, but wastes CPU cycles. |
| 9 | **No request body parsing for JSON** | `express.json()` is commented out — only `express.urlencoded()` is active | POST requests with `Content-Type: application/json` may not have their bodies parsed. The proxy middleware handles this for proxied requests, but auth-owned POST routes (like `POST /v1/token`) depend on `sarvm-utility` handling. |
| 10 | **Admin with no adminData** | `user.adminData` accessed without null check in `getSegment()` and `generateAdminData()` | If user doesn't have `adminData`, accessing `.status` throws `TypeError: Cannot read property 'status' of undefined`. |
| 11 | **`authorization.js` legacy code** | Hardcoded JWT secrets (`user_mgmt_jwt_secret_key`), references undefined `req` in `verifyToken()` | Not imported or used anywhere. Dead code. |
| 12 | **Flyy prefix for short app names** | `app_name.slice(0, -3)` for `admin` produces `adm`, for `logisticsDelivery` produces `logisticsDelive` | Inconsistent prefix lengths. Works but produces ugly IDs. |

### 11.2 Security Considerations

| # | Area | Current State | Recommendation |
|---|------|--------------|----------------|
| 1 | **JWT Secret** | Configurable via env var. Example env shows `sarvm` as secret. | In production, use a strong random secret (256+ bits). Rotate periodically. |
| 2 | **Token Expiry** | Example env shows `365d` for both access and refresh tokens. | Production should use short access tokens (15-60 min) and longer refresh tokens (7-30 days). |
| 3 | **No Rate Limiting** | No rate limiting on any endpoint. | Add rate limiting to prevent brute force token generation. |
| 4 | **No Input Validation on Routes** | Joi schemas exist but are not wired into route handlers (`validationSchema` parameter is always `undefined`). | Wire validation schemas to prevent injection attacks. |
| 5 | **HTTP-only (no HTTPS enforcement)** | Service doesn't enforce HTTPS. | HTTPS should be terminated at the load balancer level (standard in AWS ALB). |
| 6 | **CORS allows all origins** | `app.use(cors())` with no configuration. | Production should whitelist specific origins. |
| 7 | **Webhook proxy has no auth** | `/whs` routes bypass authentication entirely. | Consider webhook signature verification (e.g., HMAC signatures from payment gateways). |
| 8 | **No token revocation** | `refreshTokenTimestamp` exists in the schema but is never checked during verification. | Implement token revocation by comparing JWT `iat` against `refreshTokenTimestamp`. |

### 11.3 Limitations

1. **Single-tenant architecture:** One JWT secret for all apps/users. No multi-tenant key management.
2. **Synchronous token generation:** Token generation requires multiple sequential API calls (MongoDB lookup → RMS/LMS API → JWT signing). If any fails, the entire flow fails.
3. **No caching:** User lookups and inter-service calls are made on every token generation request. No Redis cache layer.
4. **No token blacklisting:** Once issued, a token remains valid until expiry. No mechanism to revoke individual tokens.
5. **No role-based access control (RBAC) enforcement at gateway:** The scope check (`requiresScopes`) exists as a utility but is not applied at the gateway level — all verified tokens pass through regardless of scope.
6. **Single instance proxy:** The `http-proxy-middleware` targets a single `INTERNAL_LOAD_BALANCER` URL. No built-in load balancing, circuit breaking, or retry logic.

---

## 12. Performance & Scalability

### 12.1 Performance Characteristics

| Aspect | Current | Analysis |
|--------|---------|----------|
| **Token Verification (Gateway)** | `jwt.verify()` — symmetric HS256 | ~0.1ms per verification. Very fast. No DB call needed. |
| **Token Generation (Retailer)** | MongoDB lookup + RMS API call + JWT signing | 50-200ms depending on network latency to RMS. The RMS call is the bottleneck. |
| **Token Generation (Logistics)** | MongoDB lookup + LMS API call + JWT signing | 50-200ms depending on LMS response time. |
| **Token Generation (Admin/General)** | MongoDB lookup + JWT signing | 10-30ms. No external API calls. |
| **Proxy Latency** | Adds ~1-5ms overhead for verification + proxy | Negligible compared to downstream service processing time. |
| **Connection Pooling** | Mongoose default pool (5 connections) | Adequate for moderate load. May need tuning for high concurrency. |

### 12.2 Scalability Approach

```
                    ┌────────────┐
                    │   AWS ALB   │ (External Load Balancer)
                    └──────┬─────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Auth #1  │ │ Auth #2  │ │ Auth #3  │  (Horizontal scaling)
        │ (Docker) │ │ (Docker) │ │ (Docker) │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
             └─────────────┼─────────────┘
                           │
                    ┌──────▼─────┐
                    │ Internal   │
                    │ Load       │
                    │ Balancer   │
                    └────────────┘
```

**Horizontal Scaling Properties:**
- ✅ **Stateless JWT verification** — Any auth service instance can verify any token (shared secret via env var).
- ✅ **Stateless proxy** — Any instance can proxy any request.
- ✅ **Shared MongoDB** — All instances connect to the same MongoDB cluster.
- ✅ **Docker + Kubernetes ready** — Dockerfiles provided, health check endpoint available.
- ⚠️ **CLS-Hooked sessions** — `cls-hooked` uses continuation-local storage which is per-process. This is fine for request tracing within a single instance but doesn't provide cross-instance session tracking.

### 12.3 Bottlenecks & Mitigation

| Bottleneck | Impact | Mitigation |
|-----------|--------|------------|
| MongoDB `findById` on every token generation | Adds 5-20ms per request | Add Redis cache for user lookups |
| RMS API call during retailer token generation | Adds 30-150ms, single point of failure | Cache shop data with TTL, add circuit breaker |
| LMS API call during logistics token generation | Same as above | Cache delivery profile with TTL |
| Single `INTERNAL_LOAD_BALANCER` target | No built-in failover | The internal LB should be itself load-balanced (AWS ALB/NLB) |
| JWT symmetric signing | If secret is compromised, all tokens are compromised | Consider RS256 with key rotation |

---

## 13. Future Improvements

### 13.1 Code Quality

| # | Improvement | Details | Priority |
|---|------------|---------|----------|
| 1 | **Remove legacy SQL dependencies** | Remove `knex`, `objection`, `mysql` from `package.json` and delete migration scripts | Medium |
| 2 | **Remove middleware duplication** | Consolidate `InitApp` and `server.js` — apply each middleware exactly once | Low |
| 3 | **Enable JSON body parsing** | Uncomment or add `express.json({ limit: '1mb' })` | High |
| 4 | **Wire Joi validation** | Connect the `validationSchema` parameter in `handleRESTReq` to actual validation | High |
| 5 | **Remove dead code** | Delete `authorization.js`, unused imports (`bcrypt`, `uuid`, `moment`) | Low |
| 6 | **Add TypeScript** | Type safety for payloads, configurations, and inter-service contracts | Medium |
| 7 | **Add missing fields to Mongoose schema** | Define `userType`, `flyyUserId`, `adminData` in the User schema | Medium |
| 8 | **Error specificity** | Replace generic `INTERNAL_SERVER_ERROR` with specific errors (e.g., `USER_NOT_FOUND`, `SHOP_FETCH_FAILED`) | High |

### 13.2 Security

| # | Improvement | Details | Priority |
|---|------------|---------|----------|
| 1 | **Implement token revocation** | Check `refreshTokenTimestamp` during verification. If JWT `iat` < `refreshTokenTimestamp`, reject the token. | High |
| 2 | **Add rate limiting** | Use `express-rate-limit` to prevent brute force on token endpoints | High |
| 3 | **CORS whitelist** | Configure `cors()` with specific allowed origins instead of `*` | Medium |
| 4 | **Webhook signature verification** | Validate HMAC signatures on `/whs` routes | Medium |
| 5 | **Migrate to RS256** | Asymmetric JWT signing — public key for verification, private key for signing. Enables other services to verify tokens independently. | Low (architectural change) |
| 6 | **Secret rotation** | Implement JWT secret rotation with grace period for old tokens | Medium |

### 13.3 Architecture

| # | Improvement | Details | Priority |
|---|------------|---------|----------|
| 1 | **Add Redis caching** | Cache user lookups and inter-service API responses with TTL | High |
| 2 | **Circuit breaker for external calls** | Use libraries like `opossum` for RMS and LMS calls to prevent cascade failures | High |
| 3 | **Multi-shop support** | Handle users with multiple shops in token payload | Medium |
| 4 | **Admin role permissions** | Define granular RBAC model instead of simple scope arrays | Medium |
| 5 | **Observability** | Add distributed tracing (OpenTelemetry), metrics (Prometheus), structured logging (Winston → ELK) | High |
| 6 | **API versioning strategy** | Currently only v1. Define strategy for introducing v2 without breaking existing clients. | Low |
| 7 | **Separate API Gateway** | As the platform scales, consider a dedicated API gateway (Kong, APISIX) and let auth_service focus only on token management | Long-term |

### 13.4 Testing

| # | Improvement | Details | Priority |
|---|------------|---------|----------|
| 1 | **Unit tests** | Test directory referenced in `package.json` (`./unitTests/`) but doesn't exist. Need tests for AuthManager, AuthController, AuthService. | High |
| 2 | **Integration tests** | Test full token generation flow with mocked MongoDB and external services | Medium |
| 3 | **Load testing** | Test proxy throughput and token generation under load (k6, Artillery) | Medium |

---

## 14. Summary

### 14.1 What the Auth Service Does

The Sarvm Auth Service is a **dual-purpose microservice** that serves as both:
1. **Authentication Manager** — Issues and verifies JWT tokens for four different client applications (Retailer, Household, Logistics Delivery, Admin).
2. **API Gateway / Reverse Proxy** — Intercepts every request to the platform, verifies the JWT token, and transparently proxies the request to the appropriate downstream microservice via an internal load balancer.

### 14.2 Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **JWT with HS256** | Speed and simplicity. Single service handles all signing/verification. |
| **MongoDB** | Flexible schemas for polymorphic user types (retailer, household, delivery, admin). |
| **Express as gateway** | Avoids deploying a separate API gateway. Middleware pipeline naturally supports verify → proxy flow. |
| **App-specific JWT payloads** | Downstream services can make authorization decisions from the token without additional DB queries. |
| **sarvm-utility shared library** | Consistency across all five microservices for logging, error handling, and inter-service communication. |
| **Singleton DB pattern** | Single MongoDB connection pool reused across all requests. |
| **Anonymous tokens** | Allows unauthenticated users to access public APIs in a controlled manner. |

### 14.3 File Count Summary

| Category | Files | Key Files |
|----------|-------|-----------|
| Entry & Config | 14 | `server.js`, `package.json`, `config/index.js`, `.env.example` |
| Docker | 3 | `Dockerfile`, `Dockerfile.dev`, `Dockerfile.staging` |
| Routes | 3 | `routes/index.js`, `routes/v1/Auth.js`, `routes/v1/index.js` |
| Controllers | 2 | `controllers/v1/Auth.js`, `controllers/v1/index.js` |
| Services | 3 | `services/v1/Auth.js`, `services/v1/index.js`, `services/v1/Logistic/index.js` |
| Models | 1 | `models/Users.js` |
| Database | 1 | `db/index.js` |
| Auth Library | 1 | `common/libs/AuthManager/index.js` |
| Error Handling | 5 | `ErrorHandler/index.js`, `reqToCurl.js`, `authErrors.js`, `otpErrors.js`, `serverErrors.js` |
| Utilities | 7 | `HttpResponseHandler.js`, `RequestHandler.js`, `Logger.js`, `AccessEnv.js`, etc. |
| API Docs | 1 | `openapi/openapi.json` |
| Legacy | 3 | `scripts/migrateLatest.js`, `migrateMake.js`, `migrateRollback.js` |
| **Total** | **~45** | |

### 14.4 Inter-Service Dependency Map

```
┌─────────────────────────────────────────────────┐
│                 AUTH SERVICE                      │
│                                                  │
│  DEPENDS ON:                                     │
│  ├── MongoDB (Users collection) ─── READ ONLY    │
│  ├── sarvm-utility (shared lib) ─── npm package  │
│  ├── Retailer Mgmt Service (RMS) ── HTTP GET     │
│  ├── Logistics Mgmt Service (LMS) ── HTTP GET    │
│  └── Internal Load Balancer ─────── Proxy target  │
│                                                  │
│  DEPENDED ON BY:                                 │
│  ├── ALL client applications ───── Token provider │
│  ├── ALL microservices ─────────── Gateway proxy  │
│  └── user_mgmt_service ─────────── Token issuer   │
└─────────────────────────────────────────────────┘
```

### 14.5 Critical Path

The **most critical code path** in the entire service is:

```
server.js → app.all('*') → AuthController.verifyToken() → AuthService.verifyToken() → AuthManager.verifyToken() → jwt.verify()
```

**Every single API call to the Sarvm platform** passes through this path. If this path fails, the entire platform is down. This is why the auth service should be:
- Horizontally scaled (multiple instances behind a load balancer)
- Thoroughly tested (especially the JWT verification)
- Monitored with uptime alerts
- Given the highest deployment priority

---

*Document generated on April 11, 2026. This documentation reflects the current state of the `auth_service` codebase and may need updates as the service evolves.*
