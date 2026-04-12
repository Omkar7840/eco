# Wallet Service - Deep Technical Architecture & Workflows

**Project**: Wallet Service (Underlying Package Structure: `com.sarvmai.referralreward`)
**Organization**: SARVM AI
**Stack**: Spring Boot, Java 11, PostgreSQL, Cashfree SDK, Spring Data JPA

---

## 1. Executive Summary

The **Wallet Service** operates as the central ledger out-bound settlement processor for the SARVM ecosystem. While external proxy microservices ingest funds natively via tools like Razorpay, the Wallet Service is strictly accountable for ledger validation, constraints mapping, and multi-tenant liquidity dispatching out of SARVM back into Retailer bank accounts.

Leveraging the **Cashfree Payouts API**, it calculates withdrawal algorithms against immutable balances, creates fractional splits natively linking settled payments, simulates mass batch transfers optimized for B2B payouts, handles bank webhooks, and rolls back virtual bounds upon transactional failures securely. 

## 2. Deep Component Architecture

The Wallet service introduces robust data security primitives focusing heavily on race-condition evasion specifically at the database level.

### Architecture Diagram

```mermaid
graph TD
    Client["Retailer App"] -->|"HTTPS"| API["API Gateway"]
    Admin["Admin Panel / Superuser"] -->|"HTTPS"| API
    
    API -->|"/withdrawal/request"| C1["WithdrawalController"]
    API -->|"/admin/payouts/batch-transfer"| C2["CashfreePayoutController"]
    API -->|"/api/cashfree/webhook/payout"| C3["CashfreeWebhookController"]
    API -->|"/balance/"| C4["WalletBalanceController"]
    
    C1 --> S1["WithdrawalService"]
    C2 --> S1
    C3 --> S1
    C4 --> S2["WalletBalanceService"]
    
    S1 -->|"Batch Request (REST)"| CF["Cashfree Payout Network"]
    
    S1 -.->|"Row Lock For Update"| DB[("PostgreSQL")]
    S2 -.->|"Read Immutable Value"| DB
    
    Cron["SettlementCronJob"] -->|"Daily Reconciles"| S1
```

- **Routing Layer**: Exposes granular hooks (`/api/withdrawal/request`), payout executions (`/admin/payouts/batch-transfer`), and pure ledger readouts (`/balance/`).
- **Integration Layer**: Routes outgoing batch-transfers strictly to **Cashfree** (Specializing in IMPS/NEFT routing algorithms).
- **Service Layer (`WithdrawalService`)**: Executes complex FIFO transactional logic linking specific `SarvmPaymentReconciliation` records to the specific Withdrawal and validating bounds.

## 3. High-Fidelity Data Flow Workflows

### Workflow 1: Retailer Withdrawal Initiation & Transaction Splitting (PENDING)

This workflow maps the precise constraints executed instantly when a retailer says "Withdraw ₹X from my wallet". It doesn't just debit a number; it explicitly links the exact settled transactions mapping that balance to the outbound request.

```mermaid
sequenceDiagram
    participant R as Retailer App
    participant W as WithdrawalController
    participant S as WithdrawalService
    participant DB as PostgreSQL 

    R->>W: POST /withdrawal/request (Amount ₹500)
    W->>S: createWithdrawalRequest()
    
    %% Constraints
    Note over S: Constraint Check: >= Config Min Threshold?
    S->>DB: Query Active Requests
    Note over S,DB: Block if 1+ request is PENDING/PROCESSING
    
    %% Locks
    S->>DB: findByUserIdForUpdate() [ROW LEVEL PESSIMISTIC LOCK]
    DB-->>S: WalletBalance
    
    %% Constraint 
    Note over S: Fail if WalletBalance < Amount
    
    %% Logic
    S->>S: Create SarvmWithdrawalRequest (Status: PENDING)
    S->>DB: Fetch Settled Unwithdrawn payments (Reconciliations)
    
    %% Loop
    loop FIFO Allocation Array
        Note over S: Does the reconciled transaction equal the remaining withdrawal amount?
        alt Exact/Below Amount Fits
            S->>DB: UPDATE Reconciliation SET withdrawal_id = ID
        else Amount Exceeds the rest of withdrawal
            S->>DB: Split Record. Update Origin to Remaining.
            S->>DB: Create NEW Reconcil record (Leftover Funds, _SPLIT_ ID)
        end
    end
    
    S->>DB: DEBIT withdrawable_balance & available_balance (COMMIT)
    S-->>R: Return Success (Request ID)
```

**Key Technical Detail**: The fractional chunking mechanism (`_SPLIT_ {ID}`) enforces exact 1-to-1 traceability from a Cashfree payload back to an originally ingested user purchase.

### Workflow 2: Administrative Batch Processing (PROCESSING)

SARVM admins compile pending transactions into Cashfree Batch Payloads to avoid massive API rate limits on sequential requests.

```mermaid
sequenceDiagram
    participant Admin as Sarvm Admin
    participant PC as CashfreePayoutController
    participant S as WithdrawalService
    participant CF as Cashfree APIS
    participant DB as PostgreSQL

    Admin->>PC: POST /batch-transfer (IDs: [4,5,6])
    PC->>S: processBatchTransfer()
    
    loop Per Request
        S->>DB: Filter ONLY string='PENDING'
        S->>DB: Identify Active Bank Account / VPA target
        S->>S: Threshold Scan
        Note over S: If Account=UPI & Amount > ₹1,00,000 -> Fallback IMPS Mode
        S->>S: Append to CashfreeTransfer List
    end
    
    S->>CF: POST bulk request
    CF-->>S: Return CashfreeBatchResponse (Contains Acks/Fails)
    
    S->>DB: Persist highly detailed SarvmBatchTransferLog
    S->>DB: Update specific Request status='PROCESSING'
    S-->>Admin: 200 OK
```

### Workflow 3: Settled Payload Interception (SUCCESS | ROLLBACK)

Cashfree utilizes Webhooks to independently confirm successful NEFT/UPI bank reception asynchronously (from milliseconds to T+1 hours). 

```mermaid
sequenceDiagram
    participant CF as Cashfree Webhook
    participant W as CashfreeWebhookController
    participant S as WithdrawalService
    participant DB as PostgreSQL

    CF->>W: POST /webhook/payout (transfer.success / transfer.failed)
    W->>S: updateWithdrawalStatus()
    S->>DB: FETCH withdrawal by CashfreeTransferId
    
    alt Status == SUCCESS
        S->>DB: UPDATE state='SUCCESS'
        S->>DB: Append cashfree UTR (Bank Reference ID)
    else Status == FAILED
        S->>DB: UPDATE state='FAILED'
        S->>DB: INITIATE ROLLBACK ALGORITHM
        S->>DB: findByUserIdForUpdate()
        S->>DB: CREDIT available_balance + requestedAmount
        S->>DB: unlinkWithdrawalFromReconciliationByWithdrawalId() (Free orders)
    end
    
    W-->>CF: 200 OK
```

## 4. Tech Stack Intricacies

- **Datastore Locking Mechanism**: Utilizes standard `@Transactional` wrappers paired locally with native `FOR UPDATE` PostgreSQL pessimistic row locks (`findByUserIdForUpdate`) ensuring absolute mathematical consensus.
- **External Integration Client**: Custom object mapping over `CashfreeWebhookRequest` & `CashfreeBatchResponse`.
- **Date Mechanics**: Converts natively across `OffsetDateTime` tracking precisely when bank acks drop vs when admins initialize processing.

## 5. Architectural Project Flow

```text
src/main/java/com/sarvmai/referralreward/
├── controller/        
│   ├── WithdrawalController.java        # Core Retailer Facing
│   ├── CashfreePayoutController.java    # Internal Operator Facing
│   └── CashfreeWebhookController.java   # M2M Banking Facing
├── service/           
│   └── WithdrawalService.java           # Central Logic Core (600+ LOCs)
├── entity/            
│   ├── SarvmWithdrawalRequest           # State machine entity
│   ├── SarvmBatchTransferLog            # Audit payload log
│   └── SarvmPaymentReconciliation       # Source-of-truth linkable payment mappings
├── repositories/      
│   ├── SarvmOnlinePaymentBalanceRepository # Employs standard row-locking mechanisms 
│   └── SarvmWithdrawalRequestRepository    
├── config/             # Injectible limits (MinThresholds) 
└── exception/          # Deeply bounded context threshold responses 
```

## 6. Granular Core Functionality

- **Database Pessimistic Locking**: Prevents all double-spend race conditions globally during `/api/withdrawal/request` via forcing PostgreSQL row locks on the retailer's balance entity.
- **Micro-transaction Splitting (FIFO Allocations)**: If a `Withdrawal Amount` consumes 2.5 historically settled purchases, the application surgically splits the 3rd `SarvmPaymentReconciliation` record marking half linked to the withdrawal and spawning an unlinked `leftover` instance.
- **Dynamic Bank Threshold Limiters**: Programmatically switches `PayoutMode` back down to foundational `IMPS` bounds if a user attempts to map a `UPI VPA` request over India's standard ₹1,00,000 threshold dynamically.
- **Batch Transfer Traceability**: Creates exhaustive `SarvmBatchTransferLog` entries detailing `totalTransfers`, `acknowledged`, `failedCount`, and `rawResponse` strings against the exact Cashfree bulk ID.
- **Atomic Rollbacks**: Complete reversal of balances and unlinking of exact split-associated historical payments upon Bank `transfer.failure`.

## 7. Granular API Definitions

**Exposed Endpoints**:
- `POST /api/withdrawal/request` -> Accepts `{"amount", "externalBeneficiaryId"}`. Performs the heavy FIFO isolation split and credits/debits the PGSQL Lock.
- `GET /api/withdrawal/history/{retailerId}/getWithdrawlRequestsHistory` -> Fetches all prior.
- `GET /api/withdrawal/{withdrawalId}/breakdown` -> Provides granular, per-order line-item breakdown linking exact historic consumer orders that culminated into the withdrawal grouping payload.
- `POST /admin/payouts/batch-transfer` -> Takes `List<withdrawalIds>`, processes the dynamic IMPS evaluation over the grouping, and fires it directly into the `api.cashfree.com/payout/transfers` proxy.
- `POST /api/cashfree/webhook/payout` -> Mutates internal status safely.

## 8. State Transitions (Enums & Machine)

`SarvmWithdrawalRequest.Status` Lifecycle Context:
1. **PENDING**: Balance is held internally. Not dispatched to external banks. Fully actionable.
2. **PROCESSING**: Dispatched to Cashfree via Batch. Awaiting Bank ACK. Irreversible via internal mechanics alone.
3. **SUCCESS**: Cleared the clearing-house mapping. Possesses definitive Network UTR keys.
4. **FAILED**: Failed downstream. The `WithdrawalService.rollbackWithdrawal` pipeline is forcibly executed to refund the balance back into `PENDING` states on the internal network allowing retailer retries.

## 9. Performance & Bottleneck Mitigations

- **Scalability Through Isolation**: Due to the severe pessimistic locking on active Retailer `balanceRepository.findByUserIdForUpdate`, two concurrent withdrawal taps logically wait out internal PGSQL sequencing ensuring impossible negative bounds. This heavily protects database state integrity at the cost of slight queuing on immense simultaneous loads.
- **Network Reduction**: By grouping payouts into lists inside the `CashfreePayoutController`, the internal Java environment skips spinning up 50 network `HttpUrlConnections` prioritizing 1 bulk stream.

## 10. Summary Extrapolations

The **Wallet Service** sets the high-watermark for structural integrity. The application treats its internal virtual values as inherently tethered to exact external realities, utilizing surgical logic constructs (`_SPLIT_` allocation cloning), robust Database Mutex boundaries (Pessimistic Write configurations), and granular Bulk Audit logs effectively allowing it to serve as a hardened Ledger environment.
