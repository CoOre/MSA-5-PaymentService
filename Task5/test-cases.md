# Task5 - Тест-кейсы (интеграционные и end-to-end)

Тесты корректности платёжной Saga OrchestrPay: основной flow, компенсации и corner
cases. Согласованы с Task1/Task2/Task4. Инфраструктура - **Testcontainers**
(Zeebe, PostgreSQL, Redis, моки внешних сервисов).

Компоненты: **PS** - Payment Service, **FC** - FraudCheck, **NS** - Notification,
**ORC** - оркестратор (Camunda/Zeebe), **PG** - PostgreSQL, **RD** - Redis,
**EXT** - внешние провайдеры (AML/GeoRisk).

## Основной поток и развилки антифрода

| Название | Тип | Компоненты | Предусловия |
| --- | --- | --- | --- |
| `E2E_HappyPath_Allow` | E2E | PS, ORC, FC, NS, PG | FC=`ALLOW`, баланс достаточен. Ждём: списание -> перевод -> `COMPLETED`, уведомление. |
| `E2E_FraudDeny_AutoRefund` | E2E | PS, ORC, FC, NS, PG | FC=`DENY`. Ждём: списание -> `REFUND_FUNDS` -> `REFUNDED`, уведомления клиенту и безопасности, без перевода. |
| `E2E_ManualReview_Approved` | E2E | PS, ORC, FC, NS, PG | FC=`MANUAL`, оператор `APPROVED` за 20 мин. Ждём: перевод -> `COMPLETED`. |
| `E2E_ManualReview_Rejected` | E2E | PS, ORC, FC, NS, PG | FC=`MANUAL`, оператор `REJECTED`. Ждём: `REFUND_FUNDS` -> `REFUNDED`. |
| `INT_FraudCheck_ThreeOutcomes` | Интеграционный | FC, EXT (мок), RD | Мок отдаёт `ALLOW`/`DENY`/`MANUAL`; проверка маппинга и записи в кэш. |

## Таймауты, cut-off и дедлайны

| Название | Тип | Компоненты | Предусловия |
| --- | --- | --- | --- |
| `E2E_CutOff_NoFraudResponse` | E2E | PS, ORC, FC (молчит), PG | FC не отвечает дольше cut-off. Ждём: по таймеру платёж проводится (перевод). |
| `E2E_ManualReview_Timeout_CutOff` | E2E | PS, ORC, PG | FC=`MANUAL`, оператор не решил за 20 мин. Ждём: cut-off -> платёж проводится. |
| `INT_ExternalApi_Timeout_Retry` | Интеграционный | FC, EXT (мок с задержкой) | Мок EXT медленный/с ошибкой. Проверка таймаута, retry и итога. |
| `INT_ProcessTimeout_StuckDetection` | Интеграционный | ORC, PG | Saga "завис" в `PROCESSING`. Проверка, что контроль дедлайна даёт возврат/эскалацию (Task6). |

## Компенсации и целостность Saga

| Название | Тип | Компоненты | Предусловия |
| --- | --- | --- | --- |
| `E2E_DebitFailure_Cancel_NoRefund` | E2E | PS, ORC, PG | `DEBIT_FUNDS` падает (нет баланса). Ждём: `CANCEL_PAYMENT` -> `CANCELLED`, без возврата. |
| `E2E_TransferFailure_Compensate` | E2E | PS, ORC, NS, PG | `TRANSFER` падает. Ждём: `REFUND_FUNDS` -> `FAILED`, деньги возвращены. |
| `INT_Refund_Idempotent_Retry` | Интеграционный | PS, ORC, PG | Повтор `REFUND_FUNDS`. Проверка идемпотентности: возврат ровно один раз. |
| `INT_Debit_Idempotency` | Интеграционный | PS, PG | Повторная команда `DEBIT_FUNDS` с тем же ключом. Проверка отсутствия двойного списания. |
| `E2E_PostFactumFraud_Refund` | E2E | PS, ORC, NS, PG | Платёж `COMPLETED`, приходит пост-фактум фрод. Ждём: отдельный возврат, уведомление безопасности. |
| `INT_SagaState_CrashRecovery` | Интеграционный | ORC, PG | Рестарт оркестратора в середине. Проверка восстановления состояния и продолжения. |

## Данные, кэш и инварианты

| Название | Тип | Компоненты | Предусловия |
| --- | --- | --- | --- |
| `INT_FraudResult_Cache` | Интеграционный | FC, RD | Повторная проверка платежа. Проверка чтения из Redis без обращения к EXT. |
| `INT_ParallelNotifications` | Интеграционный | ORC, NS | Ветка возврата: уведомления клиенту и безопасности параллельны; join ждёт обеих. |
| `E2E_MoneyNeverStuck_Invariant` | E2E | PS, ORC, PG | Все негативные сценарии. Инвариант: сумма либо переведена, либо возвращена - "зависших" денег нет. |
| `INT_Consistency_PS_vs_Ledger` | Интеграционный | PS, PG | Сверка статусов платежей в PS с журналом операций - консистентность данных. |
