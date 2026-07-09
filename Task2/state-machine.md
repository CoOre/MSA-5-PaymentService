# Task2 - Таблица переходов State Machine (опционально)

Состояния платёжной операции OrchestrPay и события, переводящие её между ними.
Учтены развилки антифрода (`ALLOW`/`DENY`/`MANUAL`), cut-off, ручное подтверждение
и компенсации.

## Состояния

| Состояние | Смысл |
| --- | --- |
| `CREATED` | Платёж создан, Saga стартовала. |
| `FUNDS_DEBITED` | Средства списаны/зарезервированы. |
| `FRAUD_CHECK_PENDING` | Ожидание ответа антифрода. |
| `MANUAL_REVIEW_PENDING` | Ожидание решения оператора (до 20 мин). |
| `TRANSFER_PENDING` | Идёт перевод контрагенту. |
| `COMPLETED` | Перевод выполнен, платёж завершён (терминальное). |
| `REFUNDING` | Идёт возврат средств клиенту (компенсация). |
| `REFUNDED` | Средства возвращены (терминальное). |
| `CANCELLED` | Отменён до списания (терминальное). |
| `FAILED` | Завершён ошибкой после возврата (терминальное). |

## События

`PaymentInitiated`, `FundsDebited`, `DebitFailed`, `FraudCheckStarted`, `FraudAllow`,
`FraudDeny`, `FraudManual`, `CutOffTimeExpired`, `ManualApproved`, `ManualRejected`,
`ManualReviewTimeout` (20 мин), `TransferSucceeded`, `TransferFailed`,
`RefundCompleted`, `RefundFailed`, `FraudDetectedPostFactum`.

## Таблица переходов

| Исходное состояние | Переходное состояние | Событие |
| --- | --- | --- |
| *(start)* | `CREATED` | `PaymentInitiated` |
| `CREATED` | `FUNDS_DEBITED` | `FundsDebited` |
| `CREATED` | `CANCELLED` | `DebitFailed` |
| `FUNDS_DEBITED` | `FRAUD_CHECK_PENDING` | `FraudCheckStarted` |
| `FRAUD_CHECK_PENDING` | `TRANSFER_PENDING` | `FraudAllow` |
| `FRAUD_CHECK_PENDING` | `REFUNDING` | `FraudDeny` |
| `FRAUD_CHECK_PENDING` | `MANUAL_REVIEW_PENDING` | `FraudManual` |
| `FRAUD_CHECK_PENDING` | `TRANSFER_PENDING` | `CutOffTimeExpired` (нет ответа -> разрешено) |
| `MANUAL_REVIEW_PENDING` | `TRANSFER_PENDING` | `ManualApproved` |
| `MANUAL_REVIEW_PENDING` | `REFUNDING` | `ManualRejected` |
| `MANUAL_REVIEW_PENDING` | `TRANSFER_PENDING` | `ManualReviewTimeout` (20 мин -> cut-off) |
| `TRANSFER_PENDING` | `COMPLETED` | `TransferSucceeded` |
| `TRANSFER_PENDING` | `REFUNDING` | `TransferFailed` |
| `REFUNDING` | `REFUNDED` | `RefundCompleted` |
| `REFUNDING` | `REFUNDING` | `RefundFailed` (retry) |
| `COMPLETED` | `REFUNDING` | `FraudDetectedPostFactum` |

## Пояснения к развилкам

- **`FraudDeny`** - сразу в `REFUNDING`: перевод ещё не выполнен, деньги возвращаются
  мгновенно; параллельно уведомляется служба безопасности.
- **cut-off** - если антифрод не ответил в срок, платёж проводится по умолчанию (цена
  отклонения выше цены проведения).
- **Ручная проверка** - `ManualApproved` -> перевод, `ManualRejected` -> возврат; при
  простое >20 мин `ManualReviewTimeout` срабатывает как cut-off.
- **`RefundFailed`** возвращает в `REFUNDING` (retry): возврат обязан дойти.
- **Пост-фактум** - из терминального `COMPLETED` возможен возврат при позднем
  обнаружении фрода.
