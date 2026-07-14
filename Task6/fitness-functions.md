# Task6 - Fitness-функции платёжной системы

Автоматические проверки, поддерживающие свойства платёжной Saga OrchestrPay в рантайме:
консистентность данных между сервисами, выявление "зависших" процессов, целостность
Saga и контроль таймаутов/дедлайнов. Согласованы с Task1/Task2 и требованием "деньги не
должны зависать между системами".

| Название функции | Назначение | Что проверяется | Действие при нарушении | Способ реализации |
| --- | --- | --- | --- | --- |
| `SagaStateConsistency` | Целостность состояний Saga | У всех Saga есть корректные конечные состояния; нет недопустимых переходов | Восстановление/откат до стабильного состояния; alert | Scheduled job по таблице `saga_states` |
| `PaymentTimeoutControl` | Контроль времени платежей | Платежи в `PROCESSING` дольше порога (напр. 30 мин) | Автовозврат средств + уведомление клиента | Cron job: платежи с `timestamp` старше порога и статусом `PROCESSING` |
| `MoneyConservationInvariant` | Инвариант сохранения средств | На каждый `DEBIT_FUNDS` есть ровно один финал - перевод **или** возврат | Запуск `REFUND_FUNDS`; критический alert | Reconciliation-job по журналу (debit vs transfer/refund) |
| `StuckProcessDetector` | "Зависшие" процессы | Инстансы, застрявшие в промежуточном состоянии дольше SLA | Эскалация: cut-off/компенсация, уведомление Support | Operate/Zeebe API + БД по активным инстансам |
| `CompensationCompleteness` | Полнота компенсаций | Каждый `DENY`/сбой после списания завершился `REFUND_FUNDS` | Повтор компенсации (идемпотентно); alert при исчерпании retry | Scheduled job: join `DENY`/`FAILED` с `REFUNDED` |
| `ManualReviewDeadline` | Дедлайн ручной проверки | User task не решён за 20 мин | Cut-off - платёж проводится по умолчанию | Boundary-timer в BPMN + контрольный job по задачам Tasklist |
| `CutOffEnforcement` | Cut-off внешних проверок | Нет инстансов в ожидании проверок сверх cut-off | Автоперевод в `ALLOW` и продолжение | Scheduled job по инстансам в `FRAUD_CHECK_PENDING` с превышением |
| `CrossServiceConsistency` | Консистентность между сервисами | Статусы в PS совпадают с журналом и результатами FraudCheck | Реконсиляция, alert, блок выгрузки в отчётность | Batch-сверка PS <-> ledger <-> FraudCheck |
| `RetryExhaustionMonitor` | Исчерпание retry | Job'ы с исчерпанными повторами / incident'ы Zeebe | Alert в DevOps/SRE, обработка incident'а | Мониторинг incident'ов Zeebe (Operate API) + Prometheus/Grafana |
| `IdempotencyIntegrity` | Целостность идемпотентности | Нет двойных списаний/возвратов по одному ключу | Откат дубля, корректировка баланса, alert | Scheduled job: поиск дублей по `idempotency_key` |

## Классификация функций

- **Консистентность данных:** `MoneyConservationInvariant`, `CrossServiceConsistency`, `IdempotencyIntegrity`.
- **"Зависшие" процессы:** `StuckProcessDetector`, `PaymentTimeoutControl`, `RetryExhaustionMonitor`.
- **Целостность Saga:** `SagaStateConsistency`, `CompensationCompleteness`.
- **Таймауты и дедлайны:** `ManualReviewDeadline`, `CutOffEnforcement`, `PaymentTimeoutControl`.

Большинство функций - scheduled/cron job'ы, читающие PostgreSQL (`saga_states`, журнал)
и Zeebe/Operate API, с алертингом (Prometheus/Grafana) и автокомпенсациями там, где это
безопасно.
