# Auth Service — Technical Documentation

> **Service**: `auth_service` &nbsp;|&nbsp; **Port**: `3200` &nbsp;|&nbsp; **Prefix**: `/auth/apis` &nbsp;|&nbsp; **Runtime**: Node.js 18 + Express 4 + Mongoose 6

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

### 1.1 What is Auth Service?

The **Auth Service** is the **centralized authentication and authorization gateway** of the SarvM platform. It is a lightweight, purpose-built microservice that serves exactly two critical functions:

1. **JWT Token Generation** — Constructs app-specific, role-aware JWT access and refresh tokens for authenticated users across all client applications (Retailer App, Household App, Logistics App, Admin Panel).
2. **API Gateway / Reverse Proxy** — Acts as the **front door** for the entire backend. Every inbound HTTP request from client applications passes through the Auth Service, which verifies the JWT, and then **proxies the request** to the appropriate downstream microservice via `http-proxy-middleware`.

Unlike a traditional auth service that handles login/registration directly, the SarvM Auth Service is a **token factory + API gateway hybrid**. User authentication (OTP verification) happens in UMS, which then calls Auth Service to mint tokens. All subsequent client requests flow through Auth Service's proxy layer.

### 1.2 Key Responsibilities

| Domain | Responsibility |
|---|---|
| **Token Issuance** | Generate HS256-signed JWT access + refresh tokens with app-specific payloads (scopes, segments, entity types, shop metadata) |
| **Token Verification** | Verify JWT validity on every proxied request before forwarding to downstream services |
| **API Gateway** | Reverse-proxy all non-auth requests to the internal load balancer (RMS, OMS, LMS, UMS, etc.) |
| **WebSocket Proxy** | Proxy WebSocket connections to the `/whs` path |
| **Payload Enrichment** | Enrich token payloads with cross-service data (shop details from RMS, delivery status from LMS) |
| **Segment Resolution** | Map users to analytics segments (retailer, household, sales_employee_sh/co/sso, logistics_delivery, ADMIN) |
| **Anonymous Tokens** | Issue scoped anonymous tokens for pre-login app functionality |

### 1.3 Service Identity

```
Service Name : auth
Default Port : 3200
Path Prefix  : /auth/apis
Base URL     : http://localhost:3200/auth/apis
Healthcheck  : GET /auth/apis/healthcheck
Swagger Docs : GET /auth/apis/apidocs
Database     : MongoDB (shared UMS database — read-only access to `users` collection)
```

### 1.4 Dual Role Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     AUTH SERVICE                           │
│                     Port 3200                              │
│                                                            │
│  ┌──────────────────────┐  ┌─────────────────────────────┐ │
│  │  ROLE 1: TOKEN API   │  │  ROLE 2: API GATEWAY        │ │
│  │                      │  │                             │ │
│  │  GET  /v1/token/:id  │  │  ALL /* (catch-all)        │ │
│  │  POST /v1/token      │  │    1. Verify JWT           │ │
│  │  GET  /v1/unauth_tok │  │    2. Proxy to LOAD_BAL    │ │
│  │                      │  │                             │ │
│  │  → Issues JWT tokens │  │  /whs → WebSocket proxy    │ │
│  └──────────────────────┘  └─────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CLIENT APPLICATIONS                            │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Retailer   │  │ Household  │  │ Logistics    │  │ Admin Panel  │    │
│  │ App        │  │ App        │  │ App          │  │ (Web)        │    │
│  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘  └──────┬───────┘    │
└────────┼───────────────┼────────────────┼──────────────────┼────────────┘
         │               │                │                  │
         └───────────────┴────────┬───────┴──────────────────┘
                                  │  HTTPS
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        AUTH SERVICE (Port 3200)                          │
│                     ┌──────────────────────────────┐                    │
│                     │   MIDDLEWARE PIPELINE         │                    │
│                     │                              │                    │
│                     │  1. AuthManager.decodeAuth   │                    │
│                     │  2. CLS Session              │                    │
│                     │  3. URL-encoded parser       │                    │
│                     │  4. CORS                     │                    │
│                     │  5. ReqLogger                │                    │
│                     └──────────────┬───────────────┘                    │
│                                    │                                    │
│              ┌─────────────────────┼─────────────────────┐              │
│              │                     │                     │              │
│         ┌────▼──────┐      ┌───────▼────────┐    ┌───────▼──────┐      │
│         │ /auth/apis│      │   /whs         │    │   ALL /*     │      │
│         │ /v1/token │      │   WebSocket    │    │   API Gateway│      │
│         │           │      │   Proxy        │    │              │      │
│         │ Token API │      │ → INTERNAL_LB  │    │ 1.VerifyToken│      │
│         │ (3 routes)│      │                │    │ 2.Proxy → LB │      │
│         └───────────┘      └────────────────┘    └──────────────┘      │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP Proxy
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    INTERNAL LOAD BALANCER (INTERNAL_LOAD_BALANCER)       │
│                                                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │
│  │   UMS   │  │   RMS   │  │   OMS   │  │   LMS   │  │ Notification│  │
│  │  :1207  │  │  :1206  │  │   ...   │  │   ...   │  │     ...     │  │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Layered Architecture

```
┌──────────────────────────────────────────────────╮
│  Layer 1: PROXY          http-proxy-middleware    │  Reverse proxy + WebSocket
├──────────────────────────────────────────────────┤
│  Layer 2: ROUTES         1 route file (Auth.js)  │  Token API endpoints
├──────────────────────────────────────────────────┤
│  Layer 3: CONTROLLERS    1 controller (Auth.js)  │  Payload construction + orchestration
├──────────────────────────────────────────────────┤
│  Layer 4: SERVICES       2 service files         │  JWT sign/verify + LMS integration
├──────────────────────────────────────────────────┤
│  Layer 5: AUTH MANAGER   Custom AuthManager class │  JWT operations (sign, verify, decode)
├──────────────────────────────────────────────────┤
│  Layer 6: MODEL          Users model (read-only) │  MongoDB user document lookup
╰──────────────────────────────────────────────────╯
```

### 2.3 Request Processing Pipeline

There are **two distinct request pipelines** depending on the path:

#### Pipeline A — Token API (`/auth/apis/v1/*`)

```
Client → AuthManager.decodeAuthToken → CLS Session → CORS → ReqLogger
       → Router (/auth/apis) → v1 Router → Auth Routes → handleRESTReq
       → AuthController → AuthService → AuthManager.issueTokens → Response
```

#### Pipeline B — API Gateway (`ALL /*` — catch-all)

```
Client → AuthManager.decodeAuthToken → CLS Session → CORS → ReqLogger
       → Router (/auth/apis) [miss] → Catch-all middleware
       → AuthController.verifyToken() → JWT valid? → http-proxy-middleware
       → Forward to INTERNAL_LOAD_BALANCER → Downstream service response → Client
```

### 2.4 Middleware Chain (server.js + InitApp)

1. **`AuthManager.decodeAuthToken`** (InitApp) — Extracts JWT from `Authorization` header, decodes it, populates `req.authPayload`. Handles both `accessToken` and `refreshToken` subjects. Does NOT reject invalid tokens — just skips.
2. **CLS Session** (InitApp) — Creates a `cls-hooked` namespace per request, attaches `sessionId` (cuid) and `clientIp` for distributed tracing.
3. **`express.urlencoded({ limit: '1mb' })`** (both) — Parses URL-encoded bodies. Note: `express.json()` is **commented out** in both InitApp and server.js.
4. **`cors()`** — Enables CORS for all origins.
5. **`ReqLogger`** (sarvm-utility) — Request/response logging (disabled in test mode).
6. **`AuthManager.decodeAuthToken`** (server.js) — Called **again** in server.js after InitApp. The token is decoded twice.
7. **Route matching** — `/auth/apis` prefix routes to the token API. Everything else hits the catch-all proxy.
8. **`/whs`** — Direct proxy passthrough (no token verification) for WebSocket connections.
9. **`ALL *`** — Catch-all: verifies JWT via `AuthController.verifyToken()`, then proxies to `INTERNAL_LOAD_BALANCER`.

---

## 3. Data Flow

### 3.1 Token Generation Flow (Called by UMS after OTP verification)

```
UMS (after OTP verify)              Auth Service                    RMS / LMS
       │                                 │                              │
       │  GET /auth/apis/v1/token/:userId│                              │
       │  Headers: { app_name,           │                              │
       │    app_version_code,            │                              │
       │    Authorization: Bearer <sys>} │                              │
       ├────────────────────────────────>│                              │
       │                                 │                              │
       │                                 │  1. Lookup user in MongoDB   │
       │                                 │     Users.findById(userId)   │
       │                                 │                              │
       │                                 │  2. Determine app_name       │
       │                                 │     ┌── retailerApp ────────>│
       │                                 │     │   GET /rms/apis/v1/    │
       │                                 │     │   shop/allShop/:userId │
       │                                 │     │   (via sarvm-utility)  │
       │                                 │     │                        │
       │                                 │     │<── shopId, shopMeta ───│
       │                                 │     │                        │
       │                                 │     ├── logisticsDelivery ──>│
       │                                 │     │   GET /lms/apis/v1/   │
       │                                 │     │   profile/:userId     │
       │                                 │     │                        │
       │                                 │     │<── onbording, subscr. ─│
       │                                 │     │                        │
       │                                 │     ├── admin                │
       │                                 │     │   (uses adminData      │
       │                                 │     │    from user doc)      │
       │                                 │     │                        │
       │                                 │     └── householdApp         │
       │                                 │         (general payload)    │
       │                                 │                              │
       │                                 │  3. Build payload:           │
       │                                 │     { userId, phone,         │
       │                                 │       userType, segmentId,   │
       │                                 │       flyyUserId, scope,     │
       │                                 │       shopId?, entityType? } │
       │                                 │                              │
       │                                 │  4. jwt.sign(payload, secret,│
       │                                 │     { alg:HS256, exp:365d }) │
       │                                 │                              │
       │   { accessToken, refreshToken,  │                              │
       │     body: { onbording?,         │                              │
       │            subscribed? } }      │                              │
       │<────────────────────────────────┤                              │
```

### 3.2 API Gateway Proxy Flow (Every client request)

```
Client App                  Auth Service                   Downstream Service
    │                            │                               │
    │  ANY /ums/apis/v1/users/.. │                               │
    │  Authorization: Bearer <t> │                               │
    ├───────────────────────────>│                               │
    │                            │                               │
    │                            │  1. decodeAuthToken()         │
    │                            │     → req.authPayload         │
    │                            │                               │
    │                            │  2. verifyToken(jwtToken)     │
    │                            │     → jwt.verify(token, sec)  │
    │                            │     → Valid? Continue         │
    │                            │     → Invalid? Error 500      │
    │                            │                               │
    │                            │  3. createProxyMiddleware()   │
    │                            │     → Forward original req    │
    │                            │     → Target: INTERNAL_LB    │
    │                            │                               │
    │                            │  ──────────────────────────>  │
    │                            │                               │
    │                            │  <──────────────────────────  │
    │                            │     Response from downstream  │
    │                            │                               │
    │   Response (passthrough)   │                               │
    │<───────────────────────────┤                               │
```

### 3.3 Token Payload per App Type

The Auth Service constructs **different JWT payloads** depending on the `app_name` header:

#### Retailer App (`retailerApp`)
```json
{
  "entityType": "SU",
  "entityId": "<shopId>",
  "userId": "<userId>",
  "phone": "<phone>",
  "userType": "RETAILER",
  "shopId": "<shopId>",
  "shopUniqueId": "<guid>",
  "isEmployee": false,
  "shopMeta": {
    "shop": { "shop_id": 42, "id": "abc-123", "..." : "..." },
    "flag": {
      "onBoarding": true,
      "isSubscribed": true,
      "GST_no": true,
      "isKYCVerified": true
    }
  },
  "segmentId": "retailer",
  "flyyUserId": "retailer-<uuid>",
  "scope": ["Users", "retailerApp"],
  "iat": 1234567890,
  "exp": 1266103890,
  "iss": "sarvm:ums",
  "sub": "accessToken"
}
```

#### Logistics App (`logisticsDelivery`)
```json
{
  "entityType": "LU",
  "entityId": "<userId>",
  "userId": "<userId>",
  "phone": "<phone>",
  "onbording": true,
  "subscribed": true,
  "userType": "LOGISTICS_DELIVERY",
  "segmentId": "logistics_delivery",
  "flyyUserId": "logisticsDeliv-<uuid>",
  "isEmployee": false,
  "scope": ["Users", "logisticsDelivery"]
}
```

#### Admin App (`admin`)
```json
{
  "userId": "<userId>",
  "phone": "<phone>",
  "userType": "ADMIN",
  "adminData": { "status": "active", "role": "ADMIN" },
  "segmentId": "ADMIN",
  "flyyUserId": "adm-<uuid>",
  "scope": ["ADMIN"]
}
```

#### Household App (`householdApp`) / Default
```json
{
  "userId": "<userId>",
  "phone": "<phone>",
  "userType": "INDIVIDUAL",
  "segmentId": "household",
  "flyyUserId": "householdA-<uuid>",
  "isEmployee": false,
  "scope": ["Users", "householdApp"]
}
```

### 3.4 Segment Resolution Logic

The `getSegment()` function maps users to analytics segments:

```
app_name = "retailerApp"      → segmentId = "retailer"
app_name = "householdApp"     → segmentId = "household"
  ├── userType = EMPLOYEE_SH  → segmentId = "sales_employee_sh"
  ├── userType = EMPLOYEE_SSO → segmentId = "sales_employee_sso"
  └── userType = EMPLOYEE_CO  → segmentId = "sales_employee_co"
app_name = "logisticsDelivery"→ segmentId = "logistics_delivery"
app_name = "admin"            → segmentId = adminData.role (e.g., "ADMIN")
  └── inactive admin          → segmentId = "non-admin"
```

### 3.5 FlyyUserId Construction

The `flyyUserId` is constructed for analytics/engagement platforms:

```javascript
flyyUserId = `${app_name.slice(0, -3)}-${user.flyyUserId}`
// retailerApp     → "retailer-<uuid>"
// householdApp    → "householdA-<uuid>"  (note: slices last 3 chars "App" → "householdA")
// logisticsDelivery → "logisticsDeliv-<uuid>" (slices "ery")
// admin           → "adm-<uuid>" (slices "min" — note: "admin" → slices "in" → "adm")
```

---

## 4. Tech Stack

### 4.1 Core Runtime

| Component | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | 18.20.5 | Server-side JavaScript |
| **Framework** | Express.js | 4.18.1 | HTTP routing, middleware |
| **Database Driver** | Mongoose | 6.10.0 | MongoDB ODM (read-only access to UMS database) |
| **JWT Library** | jsonwebtoken | 8.5.1 | HS256 JWT signing, verification, and decoding |
| **Proxy** | http-proxy-middleware | 2.0.6 | Reverse proxy + WebSocket forwarding to downstream services |
| **Internal Utility** | sarvm-utility | v5.0.3 (private) | Logger, ErrorHandler, ReqLogger, AuthManager (decode only), apiServices (RMS client) |

### 4.2 Infrastructure

| Component | Technology | Purpose |
|---|---|---|
| **Database** | MongoDB (shared with UMS) | Read-only access to `users` collection for user lookups during token generation |
| **Containerization** | Docker | Multi-stage build (Node 18 full → Node 18 Alpine) |
| **Session Tracking** | cls-hooked 4.2.2 | Continuation-local-storage for per-request session context |
| **Logging** | sarvm-utility (Pino-based) | Structured JSON logging with request tracing |

### 4.3 Development Tools

| Tool | Version | Purpose |
|---|---|---|
| nodemon | 2.0.16 | Auto-restart on file changes |
| eslint | 8.15.0 | Linting (Airbnb base + Prettier) |
| prettier | 2.6.2 | Code formatting |
| swagger-ui-express | 4.6.0 | Interactive API documentation |
| mocha | (test script) | Unit testing framework |

### 4.4 Unused / Legacy Dependencies

| Package | Status | Notes |
|---|---|---|
| `bcrypt` 5.0.1 | **Unused** | No password hashing in the auth flow (OTP-only system) |
| `knex` 2.0.0 | **Unused** | SQL migration tool, but MongoDB is the database |
| `mysql` 2.18.1 | **Unused** | MySQL driver, but MongoDB is used exclusively |
| `objection` 3.0.1 | **Unused** | SQL ORM for knex, not applicable |
| `joi` 17.6.0 | **Partially used** | Schema defined in `Validation/Schemas.js` but never applied as middleware |
| `morgan` 1.10.0 | **Imported but unused** | Imported in server.js, commented-out usage |
| `moment` 2.29.3 | **Unused** | No date manipulation in auth logic |
| `uuid` 8.3.2 | **Unused** | UUID generation not used here (UMS generates flyyUserId) |

---

## 5. Project Structure

```
auth_service/
├── .dev.env                        # Development environment config
├── .lcl.env                        # Local environment config
├── .prd.env                        # Production environment config
├── .stg.env                        # Staging environment config
├── .env.example                    # Environment template
├── .eslintrc.json                  # ESLint config (Airbnb + Prettier)
├── .prettierrc                     # Prettier config
├── .dockerignore                   # Docker ignore
├── .gitignore                      # Git ignore
├── Dockerfile                      # Production multi-stage Docker build
├── Dockerfile.dev                  # Development Docker build (ECR base)
├── Dockerfile.staging              # Staging Docker build (ECR base)
├── README.md                       # Mermaid architecture diagram (image link)
├── package.json                    # Dependencies + module aliases
├── jsconfig.json                   # IDE path alias mappings
├── server.js                       # Application entry point + API gateway setup
│
└── src/
    ├── InitApp/
    │   └── index.js                # App initialization (DB, middleware, CLS, error handlers)
    │
    ├── config/
    │   └── index.js                # Environment variable aggregation
    │
    ├── constants/
    │   ├── index.js                # Constants barrel (error codes only)
    │   └── errorConstants/
    │       ├── index.js            # Error barrel (server + OTP + auth errors)
    │       ├── serverErrors.js     # INTERNAL_SERVER_ERROR, PAGE_NOT_FOUND, BAD_REQUEST, DEBUG
    │       ├── authErrors.js       # ACCESSTOKEN_EXP, REFRESHTOKEN_EXP, UNAUTH_USER
    │       └── otpErrors.js        # SEND_OTP_ERROR, VERIFY_OTP_ERROR
    │
    ├── openapi/
    │   └── openapi.json            # OpenAPI 3.0.3 specification (6.6 KB)
    │
    ├── scripts/
    │   ├── migrateLatest.js        # Knex migration: run latest (legacy, unused)
    │   ├── migrateMake.js          # Knex migration: create new (legacy, unused)
    │   └── migrateRollback.js      # Knex migration: rollback (legacy, unused)
    │
    ├── common/
    │   ├── helper/
    │   │   └── index.js            # Exports AccessEnv (duplicate of utility)
    │   ├── utility/
    │   │   ├── index.js            # Exports AccessEnv
    │   │   └── AccessEnv.js        # Safe env variable accessor with caching
    │   └── libs/
    │       ├── index.js            # Barrel: Logger, RequestHandler, HttpResponseHandler, AuthManager
    │       ├── AuthManager/
    │       │   └── index.js        # ★ CORE: JWT sign, verify, decode, scope validation (130 lines)
    │       ├── HttpResponseHandler.js  # Standard success/error JSON response formatter
    │       ├── RequestHandler.js    # Axios HTTP client wrapper (get, post, put, delete)
    │       ├── Logger.js           # Re-export (27 bytes → delegates to Logger dir)
    │       ├── Logger/
    │       │   └── all-the-logs.log # Log file (artifact)
    │       ├── ErrorHandler/
    │       │   ├── index.js        # AppError class: error code resolution + curl logging
    │       │   └── reqToCurl.js    # Converts Express request to cURL command for debugging
    │       ├── Validation/
    │       │   ├── Schemas.js      # Joi user schema (fullName, email, mobile, city)
    │       │   └── Validation.js   # Joi validation middleware factory
    │       └── authorization.js    # ⚠️ LEGACY: Hardcoded JWT functions (never used)
    │
    └── apis/
        ├── db/
        │   └── index.js            # MongoDB singleton connection (shared UMS database)
        │
        ├── models/
        │   └── Users.js            # Mongoose User schema (read-only mirror of UMS Users)
        │
        ├── routes/
        │   ├── index.js            # Root router: healthcheck, swagger, v1 sub-router
        │   └── v1/
        │       ├── index.js        # V1 router registration
        │       └── Auth.js         # Token API routes (3 endpoints) + handleRESTReq wrapper
        │
        ├── controllers/v1/
        │   ├── index.js            # Controller barrel
        │   └── Auth.js             # ★ CORE: Token generation logic (315 lines)
        │
        └── services/v1/
            ├── index.js            # Service barrel
            ├── Auth.js             # Token issue + verify (delegates to AuthManager)
            └── Logistic/
                └── index.js        # LMS profile lookup for delivery boy onboarding status
```

### 5.1 File Size Analysis

| File | Lines | Bytes | Role |
|---|---|---|---|
| `controllers/v1/Auth.js` | 315 | 8,773 | **Largest** — All token payload construction logic |
| `common/libs/AuthManager/index.js` | 130 | 4,138 | JWT operations (sign, verify, decode, scope check) |
| `config/index.js` | 75 | 2,198 | Environment configuration aggregation |
| `server.js` | 98 | 2,504 | Entry point + API gateway setup |
| `InitApp/index.js` | 68 | 1,840 | App initialization |
| All other files | < 50 each | — | Supporting utilities |

**Total codebase:** ~30 source files, ~1,200 lines of application code. This is a **very lean microservice**.

---

## 6. Core Functionality

### 6.1 JWT Token Issuance (`AuthManager.issueTokens`)

This is the **most critical function** in the entire SarvM authentication pipeline. Every logged-in user's identity is defined by the JWT produced here.

#### 6.1.1 Token Structure

```javascript
// Access Token Options
const accessTokenOptions = {
  subject: 'accessToken',     // Used for token type identification
  algorithm: 'HS256',         // HMAC-SHA256 signing
  expiresIn: '365d',          // 1-year expiry (from config)
  notBefore: '120ms',         // Token valid 120ms after creation
  issuer: 'sarvm:ums',        // Issuer claim
};

// Refresh Token Options
const refreshTokenOptions = {
  ...accessTokenOptions,
  subject: 'refreshToken',    // Different subject
  expiresIn: '365d',          // Same 1-year expiry
};
```

#### 6.1.2 Access Token vs Refresh Token

| Property | Access Token | Refresh Token |
|---|---|---|
| **Payload** | Full user context (userId, phone, userType, scope, segmentId, shopMeta, etc.) | Minimal: `{ userId, scope: [] }` (empty scope) |
| **`sub` claim** | `accessToken` | `refreshToken` |
| **Expiry** | 365 days | 365 days |
| **`nbf` claim** | 120ms from creation | 120ms from creation |
| **Purpose** | Authorize API requests | Refresh expired access tokens |

#### 6.1.3 Logistics-Specific Body

When issuing tokens for `logisticsDelivery`, the response includes an additional `body` with onboarding status:

```javascript
if (payload.scope[1] === "logisticsDelivery") {
  body = {
    onbording: payload.onbording,   // Boolean
    subscribed: payload.subscribed   // Boolean
  };
}
```

### 6.2 Token Verification (`AuthManager.verifyToken`)

Used in the API gateway catch-all middleware to validate every proxied request:

```javascript
static async verifyToken(token) {
  return jwt.verify(token, HS256_TOKEN_SECRET, (err, res) => {
    if (err) throw err;    // Token invalid/expired → error propagates
    else return true;      // Token valid → request is proxied
  });
}
```

### 6.3 Token Decoding (`AuthManager.decodeAuthToken`)

This is Express middleware that runs on **every request**:

```javascript
static async decodeAuthToken(req, res, next) {
  const authString = req.headers.authorization ?? '';
  const jwtSubject = authString.split(' ')[0];  // "Bearer" or "accessToken" or "refreshToken"
  const jwtToken = authString.split(' ')[1];

  return jwt.verify(jwtToken, HS256_TOKEN_SECRET, async (err, decoded) => {
    if (err || decoded.sub !== jwtSubject) {
      if (jwtSubject === 'accessToken') return next(new ACCESSTOKEN_EXP_ERROR(err));
      if (jwtSubject === 'refreshToken') return next(new REFRESHTOKEN_EXP_ERROR(err));
    }
    req.authPayload = decoded;  // Attach decoded payload to request
    return next();
  });
}
```

**Subject Matching:** The first part of the Authorization header (`accessToken`/`refreshToken`/`Bearer`) must match the JWT's `sub` claim. If it doesn't match, a typed error is thrown.

### 6.4 Scope-Based Access Control (`AuthManager.requiresScopes`)

```javascript
static requiresScopes(scopes) {
  return async (req, res, next) => {
    const requestScopes = req.authPayload.scope;
    const requiredScope = requestScopes.filter(v => scopes.includes(v));
    if (requiredScope.length > 0) return next();
    throw Error('Not authenticated user');  // → UNAUTH_USER
  };
}
```

**Scope intersection:** At least ONE scope in the token must match ONE of the required scopes. For example, `scope: ['Users', 'retailerApp']` satisfies `requiresScopes(['Users', 'SYSTEM', 'ADMIN'])`.

### 6.5 API Gateway (Reverse Proxy)

The Auth Service doubles as the **API gateway** for all SarvM backend traffic:

```javascript
// server.js
const options = {
  target: config.url.INTERNAL_LOAD_BALANCER,  // e.g., http://localhost
  changeOrigin: true,
  ws: true,  // WebSocket support
};

// Direct WebSocket proxy (no auth)
app.use('/whs', createProxyMiddleware(options));

// Authenticated proxy (all other routes)
app.all('*',
  async (req, res, next) => {
    await AuthController.verifyToken(dataValues);  // Verify JWT
    next();
  },
  createProxyMiddleware(options)  // Forward to internal load balancer
);
```

**Key behaviors:**
- `/whs` requests are proxied **without** token verification (WebSocket handshake)
- All other requests require a valid JWT before being proxied
- The proxy preserves the original request path, method, headers, and body
- `changeOrigin: true` rewrites the `Host` header to match the target
- WebSocket connections are supported (`ws: true`)

### 6.6 Anonymous Token Generation

For pre-login app functionality (browsing catalogues, viewing public data):

```javascript
const getUnauthorizeToken = async (dataValues) => {
  const payload = {
    userId: 'anonymous',
    scope: [app_name],  // e.g., ['retailerApp']
  };
  return AuthService.issueToken(payload);
};
```

The anonymous token has `userId: 'anonymous'` and a scope limited to the requesting app. No user lookup occurs.

### 6.7 Direct Token Generation

A `POST /token` endpoint allows arbitrary payload signing:

```javascript
const generateToken = async (payload) => AuthService.issueToken(payload);
```

This endpoint accepts **any payload** and signs it into a JWT. It's used for inter-service system tokens.

---

## 7. APIs & Integrations

### 7.1 Inbound API Endpoints (5 total)

| Route | Method | Auth Required | Description |
|---|---|---|---|
| `/auth/apis/healthcheck` | GET | No | Returns `{ ts, buildNumber }` |
| `/auth/apis/apidocs` | GET | No | Swagger UI documentation |
| `/auth/apis/v1/token/:userId` | GET | Yes (headers) | **Primary**: Generate access + refresh tokens for a user |
| `/auth/apis/v1/token` | POST | No | Generate token from arbitrary payload (system use) |
| `/auth/apis/v1/unauth_token` | GET | No | Generate anonymous scoped token |

### 7.2 Endpoint Detail

#### `GET /auth/apis/v1/token/:userId` — Primary Token Generation

**Called by:** UMS (after OTP verification)

**Required Headers:**
```
app_name: "retailerApp" | "householdApp" | "logisticsDelivery" | "admin"
app_version_code: "101"
Authorization: Bearer <system_token>
```

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `userId` | String | MongoDB ObjectId of the user |

**Process:**
1. Looks up user in MongoDB: `Users.findById(userId)`
2. Based on `app_name`, constructs app-specific payload:
   - `retailerApp` → Calls RMS for shop data, builds retailer payload with shopMeta
   - `logisticsDelivery` → Calls LMS for delivery boy profile (onboarding + subscription status)
   - `admin` → Reads `adminData` from user document, sets ADMIN scope
   - `householdApp` (default) → Builds general payload with household segment
3. Signs payload into JWT via `AuthManager.issueTokens()`

**Response (200):**
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

For `logisticsDelivery`, `body` contains:
```json
{
  "body": {
    "onbording": true,
    "subscribed": false
  }
}
```

#### `POST /auth/apis/v1/token` — System Token Generation

**Called by:** Internal services needing custom tokens

**Body:** Any valid JSON payload to be signed into a JWT.

**Response:** Same as above (accessToken + refreshToken).

#### `GET /auth/apis/v1/unauth_token` — Anonymous Token

**Called by:** Client apps before user login

**Required Headers:**
```
app_name: "retailerApp" | "householdApp" | "logisticsDelivery"
```

**Response:** JWT with `userId: 'anonymous'` and scope limited to the app_name.

### 7.3 Outbound Inter-Service API Calls

#### 7.3.1 RMS (Retailer Management Service) — 1 Call

| Method | Endpoint | Called Via | Purpose |
|---|---|---|---|
| GET | `/rms/apis/v1/shop/allShop/:userId` | `sarvm-utility.apiServices.rms.getAllShopViaUserId()` | Fetch shop details (shop_id, guid, KYC status, subscription, GST) for retailer token payload |

**Response data used:**
- `shopId` → Included directly in JWT payload
- `shopUniqueId` (guid) → Included in JWT payload
- `isKYCVerified`, `isSubscribed`, `GST_no` → Packed into `shopMeta.flag`
- Full shop object → Packed into `shopMeta.shop`

#### 7.3.2 LMS (Logistics Management Service) — 1 Call

| Method | Endpoint | Called Via | Purpose |
|---|---|---|---|
| GET | `/lms/apis/v1/profile/:userId` | Direct `axios` call | Fetch delivery boy profile for logistics token payload |

**Response data used:**
- `deliveryData.onbording` → Included in JWT payload + response body
- `deliveryData.subscribed` → Included in JWT payload + response body

### 7.4 Proxied Services (API Gateway)

The Auth Service proxies to these downstream services via `INTERNAL_LOAD_BALANCER`:

| Service | Path Prefix | Port |
|---|---|---|
| UMS | `/ums/apis/*` | 1207 |
| RMS | `/rms/apis/*` | 1206 |
| OMS | `/oms/apis/*` | — |
| LMS | `/lms/apis/*` | — |
| Notification | `/ms/apis/*` | — |
| Referral | `/ref_ms/apis/*` | — |
| WebSocket | `/whs/*` | — |

### 7.5 Error Response Format

All errors follow the `AppError` class format:

```json
{
  "success": false,
  "error": {
    "code": "ACCESSTOKEN_EXP_ERROR",
    "message": "Access Token expired"
  }
}
```

**Error Codes:**

| Code | HTTP Status | Message |
|---|---|---|
| `INTERNAL_SERVER_ERROR` | 500 | Internal Server Error |
| `PAGE_NOT_FOUND_ERROR` | 404 | Page not found |
| `BAD_REQUEST_ERROR` | 400 | Bad request |
| `ACCESSTOKEN_EXP_ERROR` | 200 | Access Token expired |
| `REFRESHTOKEN_EXP_ERROR` | 200 | Refresh token expired |
| `UNAUTH_USER` | 200 | Unauthenticated access detected |
| `SEND_OTP_ERROR` | 200 | Unable to send OTP |
| `VERIFY_OTP_ERROR` | 200 | Unable to verify OTP |

> **Note:** Auth errors return HTTP 200 with `success: false`. This is an intentional design choice — the client inspects the `error.code` field rather than the HTTP status code.

---

## 8. Database Design

### 8.1 Database Access Pattern

| Property | Value |
|---|---|
| **Engine** | MongoDB |
| **ODM** | Mongoose 6.10.0 |
| **Database** | `ums` (shared with UMS — same database) |
| **Access** | **Read-only** — Auth Service only reads the `users` collection |
| **Operation** | `Users.findById(userId)` — Single document lookup per token request |

### 8.2 User Schema (Read-Only Mirror)

The Auth Service defines a **minimal subset** of the UMS User schema:

```javascript
const UserSchema = new mongoose.Schema({
  username: String,                    // Optional
  phone: { type: String, required: true, unique: true },
  refreshTokenTimestamp: {
    type: Number,
    required: true,
    default: Math.round(new Date().getTime() / 1000)
  },
  basicInformation: {
    personalDetails: {
      firstName: String,
      lastName: String,
      FathersName: String,          // Note: capital F (differs from UMS)
      DOB: Date,
      Gender: String,
      secondaryMobileNumber: String,
      emailID: String               // Note: "ID" not "Id" (differs from UMS)
    },
    kycDetails: { kycId: String },
    transactionDetails: { transactionDetailsId: String }
  },
  retailerData: {},                  // Empty schema-less subdoc
  deliveryData: {},                  // Empty schema-less subdoc
  householdData: {}                  // Empty schema-less subdoc
});
```

**Key observations:**
- Schema is **deliberately minimal** — Auth Service only needs `phone`, `userType`, `flyyUserId`, and `adminData` from the user document.
- `retailerData`, `deliveryData`, `householdData` are defined as empty objects (schema-less) because Mongoose strict mode would reject unknown fields.
- The model reads from the same `users` collection as UMS — no data duplication.
- `refreshTokenTimestamp` is defined but never used in the token generation logic.

### 8.3 Fields Actually Used

Despite the full schema definition, the Auth Service only reads these fields:

| Field | Used In | Purpose |
|---|---|---|
| `_id` | `findById()` | User lookup |
| `phone` | Token payload | User phone number |
| `userType` | `getUserType()`, `getSegment()` | Role determination (INDIVIDUAL, EMPLOYEE_SH/CO/SSO) |
| `flyyUserId` | Token payload | Analytics user identifier |
| `adminData.status` | `getSegment()` | Admin active/inactive check |
| `adminData.role` | `generateAdminData()` | Admin role in token |

---

## 9. Setup & Installation

### 9.1 Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18.x (18.20.5 recommended) |
| npm | 8+ |
| MongoDB | Access to UMS database (read) |
| Downstream services | UMS, RMS, LMS running (for token enrichment) |

### 9.2 Environment Configuration

```env
NODE_ENV=development
ENV=dev
BUILD_NUMBER=101

# Host
HOST=localhost
HOST_PORT=3200
HOST_SERVICE_NAME=auth

# MongoDB (shared with UMS — same database)
MONGO_URL=mongodb://<user>:<pass>@<host>:27017/ums?retryWrites=false

# JWT
HS256_TOKEN_SECRET=sarvm
ACCESS_TOKEN_EXPIRESIN=365d
REFRESH_TOKEN_EXPIRESIN=365d

# Internal services (proxy target)
INTERNAL_LOAD_BALANCER=http://localhost
LOAD_BALANCER=http://localhost

# Logging
PINO_LOG_LEVEL=info
```

### 9.3 Environment Files

| File | Target | MongoDB |
|---|---|---|
| `.lcl.env` | Local development | `mongodb://localhost:27017/ums` |
| `.dev.env` | Dev server | AWS DocumentDB (dev cluster) |
| `.stg.env` | Staging (UAT) | AWS DocumentDB (UAT cluster, read-only) |
| `.prd.env` | Production | `[]` (placeholder — set via system env) |

### 9.4 Local Development

```bash
# Install dependencies
npm install

# Run with local env
npm run lcl         # Uses .lcl.env

# Run with dev env
npm run lcl:dev     # Uses .dev.env

# Run with staging env
npm run lcl:stg     # Uses .stg.env

# Run with production env
npm run lcl:prd     # Uses .prd.env

# Run tests
npm test
```

### 9.5 Docker Deployment

```dockerfile
# Production: Multi-stage build
FROM node:18.20.5 AS build
WORKDIR /usr/src/app
COPY package.json package-lock.json server.js ./
RUN npm ci --production --no-audit

FROM node:18.20.5-alpine
WORKDIR /usr/src/app
COPY --from=build /usr/src/app ./
COPY src ./src
VOLUME ["/usr/src/logs"]
EXPOSE 3200
CMD ["sh", "-c", "NODE_ENV=production npm run-script stg"]
```

```bash
docker build --build-arg BUILD_NUMBER=101 -t auth:latest .
docker run -p 3200:3200 auth:latest
```

### 9.6 npm Scripts

| Script | Command | Environment |
|---|---|---|
| `npm run lcl` | nodemon + .lcl.env | Local |
| `npm run lcl:dev` | nodemon + .dev.env | Dev |
| `npm run lcl:stg` | nodemon + .stg.env | Staging |
| `npm run lcl:prd` | nodemon + .prd.env | Production |
| `npm run prd` | nodemon (no dotenv) | System env |
| `npm test` | mocha (8 GB heap) | Test |

---

## 10. User Flow

### 10.1 Complete Login-to-API-Call Flow

```
1.  User enters phone number in Retailer App
2.  App → UMS: POST /ums/apis/v1/users/send_otp/sms
3.  User receives OTP, enters it
4.  App → UMS: POST /ums/apis/v1/users/verify_otp { phone, otp }

    ── UMS internally ──
5.  UMS verifies OTP successfully
6.  UMS → Auth Service: GET /auth/apis/v1/token/<userId>
    Headers: { app_name: "retailerApp", Authorization: Bearer <system> }

    ── Auth Service ──
7.  Auth Service: Users.findById(userId) → fetches user document
8.  Auth Service: app_name = "retailerApp" → calls generateRetailerData()
9.  Auth Service → RMS: getAllShopViaUserId() → gets shop data
10. Auth Service: Builds payload { entityType:"SU", shopId, shopMeta, scope, ... }
11. Auth Service: jwt.sign(payload, "sarvm", { alg:HS256, exp:365d })
12. Auth Service → UMS: { accessToken, refreshToken }

    ── UMS responds to App ──
13. UMS → App: { isNewUser, _id, accessToken, refreshToken, ... }

    ── Subsequent API Calls ──
14. App → Auth Service: GET /ums/apis/v1/users/<userId>
    Authorization: Bearer <accessToken>
15. Auth Service: decodeAuthToken() → req.authPayload
16. Auth Service: verifyToken() → jwt.verify succeeds
17. Auth Service → UMS (proxy): Forward request to INTERNAL_LB/ums/...
18. UMS processes request, returns response
19. Auth Service → App: Proxied response (passthrough)
```

### 10.2 Anonymous Browsing Flow

```
1.  User opens Household App (not logged in)
2.  App → Auth Service: GET /auth/apis/v1/unauth_token
    Headers: { app_name: "householdApp" }

3.  Auth Service: No DB lookup needed
4.  Auth Service: jwt.sign({ userId:"anonymous", scope:["householdApp"] })
5.  Auth Service → App: { accessToken, refreshToken }

6.  App → Auth Service: GET /rms/apis/v1/shop/nearby?lat=...&lon=...
    Authorization: Bearer <anonymous_accessToken>
7.  Auth Service: verifyToken() → valid (anonymous token is a valid JWT)
8.  Auth Service → RMS (proxy): Forward request
9.  RMS → Auth Service → App: Nearby shops data
```

### 10.3 Logistics Driver Login Flow

```
1.  Driver opens Logistics App, enters phone, receives OTP
2.  UMS verifies OTP, calls Auth Service:
    GET /auth/apis/v1/token/<userId>
    Headers: { app_name: "logisticsDelivery" }

3.  Auth Service:
    a. Users.findById(userId) → user document
    b. app_name = "logisticsDelivery" → generateLogisticData()
    c. Calls LMS: GET /lms/apis/v1/profile/<userId>
       → Gets { deliveryData: { onbording: true, subscribed: false } }
    d. Builds payload:
       { entityType:"LU", onbording:true, subscribed:false,
         userType:"LOGISTICS_DELIVERY", segmentId:"logistics_delivery", ... }
    e. Signs JWT

4.  Returns: { accessToken, refreshToken,
               body: { onbording: true, subscribed: false } }
```

### 10.4 Admin Panel Login Flow

```
1.  Admin logs into web panel → OTP verified by UMS
2.  UMS → Auth Service: GET /auth/apis/v1/token/<userId>
    Headers: { app_name: "admin" }

3.  Auth Service:
    a. Users.findById(userId) → user document (with adminData)
    b. app_name = "admin" → generateAdminData()
    c. Reads user.adminData: { status: "active", role: "ADMIN" }
    d. segmentId = getSegment() → "ADMIN" (from adminData.role)
    e. Builds payload:
       { userId, phone, userType:"ADMIN",
         adminData: { status: "active", role: "ADMIN" },
         segmentId: "ADMIN", scope: ["ADMIN"] }
    f. Signs JWT with scope: ["ADMIN"] (NOT ["Users", "admin"])

4.  Returns: { accessToken, refreshToken }
```

### 10.5 Employee via Household App Flow

```
1.  Employee (SH role) logs into Household App
2.  UMS → Auth Service: GET /auth/apis/v1/token/<userId>
    Headers: { app_name: "householdApp" }

3.  Auth Service:
    a. Users.findById(userId) → user.userType = "EMPLOYEE_SH"
    b. app_name = "householdApp" → generateGeneralData()
    c. getUserType("householdApp", "EMPLOYEE_SH") → returns "EMPLOYEE_SH"
       (householdApp does NOT remap userType like retailerApp does)
    d. getSegment() → "sales_employee_sh" (employee-specific segment)
    e. isEmployee = "EMPLOYEE_SH".includes("EMPLOYEE") → true
    f. Builds payload:
       { userType: "EMPLOYEE_SH", segmentId: "sales_employee_sh",
         isEmployee: true, scope: ["Users", "householdApp"] }

4.  Returns: { accessToken, refreshToken }
```

---

## 11. Edge Cases & Limitations

### 11.1 Known Issues

| Issue | Severity | Detail | Location |
|---|---|---|---|
| **`express.json()` is commented out** | 🔴 Critical | JSON body parsing is disabled. `POST /token` may fail for JSON payloads. URL-encoded bodies work, but this is unusual for a JSON API. | `server.js:29`, `InitApp/index.js:40` |
| **`decodeAuthToken` runs twice** | 🟡 Medium | Called once in `InitApp/index.js:20` and again in `server.js:39`. Token is decoded twice per request. | `server.js:39` |
| **`Logger` undefined in Auth service** | 🔴 Critical | `services/v1/Auth.js:13` references `Logger.error()` but `Logger` is never imported in that file. This will throw a `ReferenceError` on token issuance failure. | `services/v1/Auth.js:13` |
| **Unused `createProxyMiddleware` import** | 🟢 Low | Imported in `services/v1/Auth.js:6` but never used there. Only used in `server.js`. | `services/v1/Auth.js:6` |
| **`authorization.js` is dead code** | 🟢 Low | Contains hardcoded JWT secret (`user_mgmt_jwt_secret_key`), references `req` without parameter, and is never imported anywhere. | `common/libs/authorization.js` |
| **`flyyUserId` slice logic inconsistent** | 🟡 Medium | `app_name.slice(0, -3)` produces odd results: `admin` → `ad`, `householdApp` → `householdA`, `logisticsDelivery` → `logisticsDeliv`. | `controllers/v1/Auth.js:115,150,177,250` |
| **Error log says wrong app** | 🟢 Low | `generateLogisticData` at line 154 logs `'In retailerApp app'` — incorrect log message. `generateAdminData` at line 180 logs `'In deliveryApp app'`. | `controllers/v1/Auth.js:154,180` |
| **POST /token accepts any payload** | 🟡 Medium | The `generateToken` endpoint signs **any** payload into a JWT without validation. Could be misused to mint arbitrary tokens. | `controllers/v1/Auth.js:307` |
| **`package.json` says "user_mgmt_service"** | 🟢 Low | The `name` field is `"user_mgmt_service"` instead of `"auth_service"`. | `package.json:2` |
| **Unused migration scripts** | 🟢 Low | `scripts/migrateLatest.js`, `migrateMake.js`, `migrateRollback.js` reference Knex (SQL) but the service uses MongoDB. | `src/scripts/` |

### 11.2 Security Concerns

| Concern | Detail |
|---|---|
| **JWT Secret is `sarvm`** | A 5-character string as HS256 secret is extremely weak. Trivially brute-forceable. Should be min 256-bit random key. |
| **365-day token expiry** | Both access and refresh tokens expire in 1 year. No short-lived access tokens with refresh rotation. |
| **No refresh token rotation** | The refresh token is stateless (no server-side tracking). Cannot be revoked. |
| **`refreshTokenTimestamp` is unused** | The User schema has `refreshTokenTimestamp` but it's never checked during verification — tokens can't be invalidated. |
| **Auth errors return HTTP 200** | `ACCESSTOKEN_EXP_ERROR`, `REFRESHTOKEN_EXP_ERROR`, `UNAUTH_USER` all return HTTP 200. Clients must inspect the body, not the status code. Non-standard. |
| **`/whs` has no auth** | WebSocket proxy path is completely unauthenticated. Any incoming connection is forwarded. |
| **POST /token has no auth guard** | Anyone who can reach the endpoint can sign arbitrary payloads into valid JWTs. No scope or authorization check. |
| **No CSRF protection** | No CSRF tokens or SameSite cookie configuration. |
| **No rate limiting** | No rate limiting on token generation or proxy endpoints. |

### 11.3 Reliability Concerns

| Concern | Detail |
|---|---|
| **Single point of failure** | Auth Service is the API gateway — if it goes down, ALL backend services are unreachable. |
| **No circuit breaker** | RMS/LMS calls during token generation have no circuit breaker. If RMS is down, retailer token generation fails entirely. |
| **No retry logic** | Inter-service calls (to RMS/LMS) have no retry mechanism. |
| **Proxy timeout undefined** | `createProxyMiddleware` uses default timeouts. No explicit timeout configuration. |
| **No graceful shutdown** | No `SIGTERM`/`SIGINT` handling. Active connections are dropped on restart. |

---

## 12. Performance & Scalability

### 12.1 Request Latency Breakdown

| Operation | Latency | Occurs On |
|---|---|---|
| JWT decode (middleware) | < 1ms | Every request |
| JWT verify (gateway) | < 1ms | Every proxied request |
| Proxy passthrough | ~1-5ms overhead | Every proxied request |
| **Token generation (household)** | ~5-10ms | DB lookup + JWT sign |
| **Token generation (retailer)** | ~50-200ms | DB lookup + RMS HTTP call + JWT sign |
| **Token generation (logistics)** | ~50-200ms | DB lookup + LMS HTTP call + JWT sign |

Token generation for `retailerApp` and `logisticsDelivery` are significantly slower due to synchronous HTTP calls to RMS/LMS.

### 12.2 Throughput Characteristics

| Metric | Estimate |
|---|---|
| **Gateway proxy throughput** | High — minimal overhead (decode + verify + forward) |
| **Token generation throughput** | Medium — limited by MongoDB + downstream HTTP calls |
| **Memory footprint** | Low — no caching, no in-memory state |

### 12.3 Bottlenecks

| Bottleneck | Impact | Mitigation |
|---|---|---|
| **Synchronous RMS call per retailer token** | Adds 50-200ms per login | Cache shop data in Redis |
| **Synchronous LMS call per logistics token** | Adds 50-200ms per login | Cache delivery profile |
| **MongoDB lookup per token request** | Adds 5-10ms per token | Cache user documents (short TTL) |
| **Single-process architecture** | CPU-bound operations (JWT sign/verify) limited to 1 core | Use PM2 cluster mode or Kubernetes replicas |
| **No connection pooling config** | Mongoose default pool size | Configure `poolSize` based on expected load |

### 12.4 Scaling Strategy

Since Auth Service is the API gateway, it needs **horizontal scaling** more than any other service:

```
Client → Load Balancer → [ Auth Service N1 ]  → Internal LB → Backend
                        → [ Auth Service N2 ]
                        → [ Auth Service N3 ]
```

Each Auth Service instance is **stateless** (JWT verification is symmetric), making horizontal scaling straightforward.

---

## 13. Future Improvements

### 13.1 Critical (P0)

| Improvement | Rationale |
|---|---|
| **Fix `express.json()` — uncomment** | JSON body parsing is essential for `POST /token`. Currently commented out. |
| **Fix `Logger` import in `Auth.js` service** | Will throw `ReferenceError` on any token issuance error path. |
| **Strengthen JWT secret** | Replace `sarvm` with a 256+ bit random key stored in AWS Secrets Manager. |
| **Implement short-lived access tokens** | Change access token expiry to 15-30 minutes, keep refresh at 30-60 days. |
| **Add auth guard to POST /token** | Require system token or internal network check to prevent arbitrary token minting. |
| **Add rate limiting** | Express-rate-limit on token endpoints to prevent brute-force attacks. |

### 13.2 High Priority (P1)

| Improvement | Rationale |
|---|---|
| **Implement refresh token rotation** | Issue new refresh token on each refresh, invalidate old one. Use `refreshTokenTimestamp` (already in schema). |
| **Add circuit breaker for RMS/LMS** | Use opossum/cockatiel to prevent cascading failures when downstream services are down. |
| **Cache user + shop data** | Redis cache for user documents and shop data with 5-min TTL to reduce DB/HTTP load. |
| **Return proper HTTP status codes** | Auth errors should return 401/403, not 200. |
| **Remove duplicate `decodeAuthToken`** | Called twice (InitApp + server.js). Remove one. |
| **Add graceful shutdown** | Handle SIGTERM to drain connections before exit. |

### 13.3 Medium Priority (P2)

| Improvement | Rationale |
|---|---|
| **Remove unused dependencies** | bcrypt, knex, mysql, objection, morgan, moment, uuid — all unused |
| **Fix flyyUserId generation** | `app_name.slice(0, -3)` is fragile. Use a proper mapping. |
| **Fix wrong log messages** | `generateLogisticData` logs "retailerApp", `generateAdminData` logs "deliveryApp" |
| **Delete `authorization.js`** | Dead code with hardcoded secrets |
| **Fix `package.json` name** | Change from `user_mgmt_service` to `auth_service` |
| **Add proxy timeout config** | Set explicit timeouts on `createProxyMiddleware` |
| **Add request body parsing for proxy** | Currently `express.json()` is commented out, which may cause issues with body forwarding |

### 13.4 Low Priority (P3)

| Improvement | Rationale |
|---|---|
| **Add health checks for downstream** | Healthcheck should verify MongoDB + downstream service connectivity |
| **Move segment mapping to config** | Hardcoded in controller — should be externalized |
| **Complete OpenAPI spec** | Current spec only documents 3 of 5 endpoints |
| **Add integration tests** | Verify token generation for all 4 app types |
| **Fix UserSchema field name inconsistencies** | `FathersName` vs UMS's `fathersName`, `emailID` vs `emailId` |

---

## 14. Summary

### 14.1 Service Overview

The **Auth Service** is a **lightweight JWT token factory and API gateway hybrid** for the SarvM platform. Running on **Node.js 18 + Express 4 + Mongoose 6**, it serves just **5 API endpoints** but handles **100% of client-to-backend traffic** through its reverse proxy. It issues app-specific, role-aware JWT tokens enriched with cross-service data (shop details from RMS, delivery status from LMS), and verifies every proxied request for valid authentication.

### 14.2 Key Numbers

| Metric | Value |
|---|---|
| Total API Endpoints | 5 (3 token + healthcheck + swagger) |
| Route Files | 1 |
| Controller Files | 1 |
| Service Files | 2 |
| MongoDB Collections | 1 (read-only: `users`) |
| Inter-Service API Calls | 2 (RMS shop lookup, LMS profile lookup) |
| Cron Jobs | 0 |
| Lines of Code | ~1,200 (30 source files) |
| Largest File | `controllers/v1/Auth.js` — 315 lines |

### 14.3 Architecture Summary

```
           ┌─────────────────────────────────────────┐
           │          AUTH SERVICE (:3200)            │
           │                                         │
           │  ┌─────────────┐  ┌──────────────────┐  │
           │  │ Token API   │  │ API Gateway      │  │
           │  │ 3 endpoints │  │ Reverse Proxy    │  │
           │  │             │  │ (catch-all /*)   │  │
           │  └──────┬──────┘  └────────┬─────────┘  │
           │         │                  │             │
           │  ┌──────▼──────┐  ┌────────▼─────────┐  │
           │  │ AuthManager │  │ http-proxy-mw    │  │
           │  │ JWT Sign    │  │ → INTERNAL_LB    │  │
           │  │ JWT Verify  │  │ + WebSocket      │  │
           │  └──────┬──────┘  └──────────────────┘  │
           │         │                                │
           │  ┌──────▼──────┐                         │
           │  │ MongoDB     │                         │
           │  │ users (R/O) │                         │
           │  └─────────────┘                         │
           └────────────────────┬────────────────────┘
                                │ Proxy
           ┌────────────────────▼────────────────────┐
           │        INTERNAL LOAD BALANCER           │
           │  UMS · RMS · OMS · LMS · Notification   │
           └─────────────────────────────────────────┘
```

### 14.4 Critical Dependencies

The Auth Service **cannot function** without:
1. **MongoDB** — User document lookup for token payload construction
2. **HS256 Secret** — Shared secret for JWT signing/verification (all services must use the same secret)
3. **`INTERNAL_LOAD_BALANCER`** — Target for reverse proxy (if down, no backend services are reachable)
4. **sarvm-utility** — ErrorHandler classes, Logger, ReqLogger, RMS API client

### 14.5 Deployment

- **Container**: Multi-stage Docker (Node 18 → Alpine)
- **Port**: 3200
- **Startup**: `NODE_ENV=production npm run-script stg`
- **Health**: `GET /auth/apis/healthcheck` → `{ ts, buildNumber }`
- **Swagger**: `GET /auth/apis/apidocs`

### 14.6 Key Design Decisions

| Decision | Rationale |
|---|---|
| **Shared UMS database** | Auth Service reads user data directly instead of calling UMS API — reduces latency on the critical token generation path. |
| **API gateway in auth service** | Centralizes authentication enforcement — no downstream service needs to independently verify tokens. |
| **App-specific token payloads** | Each app (Retailer/Household/Logistics/Admin) gets a tailored JWT with relevant metadata — reduces client-side API calls after login. |
| **Stateless JWT verification** | No token blacklist or server-side session storage — enables horizontal scaling. Trade-off: tokens cannot be revoked before expiry. |
| **Anonymous tokens** | Allows pre-login functionality (browse shops, view public data) while still passing through the auth gateway. |

---

> **Document generated**: April 2026 &nbsp;|&nbsp; **Covers**: Full codebase analysis of `auth_service`
