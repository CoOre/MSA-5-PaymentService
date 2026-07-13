'use strict';

/**
 * OrchestrPay - Payment Service.
 * Набор Zeebe job-воркеров, реализующих шаги Saga-процесса обработки платежа
 * (см. process.bpmn), плюс небольшой HTTP-эндпоинт для ручного запуска инстансов
 * и авто-демо всех трёх сценариев антифрода.
 */

const http = require('http');
const { ZBClient } = require('zeebe-node');

const ZEEBE_ADDRESS = process.env.ZEEBE_ADDRESS || 'localhost:26500';
const PROCESS_ID = 'payment-process';
const PORT = Number(process.env.PORT || 3000);
const RUN_DEMO = process.env.RUN_DEMO !== 'false';

const zbc = new ZBClient(ZEEBE_ADDRESS);

const ts = () => new Date().toISOString();
const log = (emoji, step, job, extra = '') => {
  const pid = (job && job.variables && job.variables.paymentId) || '-';
  console.log(`${ts()} ${emoji} [${step}] payment=${pid} ${extra}`.trim());
};

/* ------------------------------------------------------------------ */
/*  Воркеры (обработчики шагов)                                        */
/* ------------------------------------------------------------------ */

// 1. Создание платежа - старт Saga
zbc.createWorker({
  taskType: 'create-payment',
  taskHandler: async (job) => {
    const paymentId = job.variables.paymentId || `PAY-${job.processInstanceKey}`;
    log('🧾', 'CREATE_PAYMENT', { variables: { paymentId } },
      `order=${job.variables.orderId || '-'} amount=${job.variables.amount || '-'}`);
    return job.complete({ paymentId, status: 'CREATED' });
  },
});

// 2. Списание средств со счёта клиента (компенсируемая)
zbc.createWorker({
  taskType: 'debit-funds',
  taskHandler: async (job) => {
    log('💳', 'DEBIT_FUNDS', job, `-> списано ${job.variables.amount || '-'}`);
    return job.complete({ status: 'FUNDS_DEBITED', debited: true });
  },
});

// 3. Антифрод-проверка - эмуляция трёх сценариев: ALLOW / DENY / MANUAL
zbc.createWorker({
  taskType: 'fraud-check',
  taskHandler: async (job) => {
    let result = (job.variables.scenario || '').toUpperCase();
    if (!['ALLOW', 'DENY', 'MANUAL'].includes(result)) {
      const r = Math.random();
      result = r < 0.6 ? 'ALLOW' : r < 0.8 ? 'MANUAL' : 'DENY';
    }
    log('🕵️', 'FRAUD_CHECK', job, `=> ${result}`);
    return job.complete({ fraudResult: result });
  },
});

// 4. Перевод средств контрагенту - PIVOT (необратимая)
zbc.createWorker({
  taskType: 'transfer-funds',
  taskHandler: async (job) => {
    log('🏦', 'TRANSFER_TO_COUNTERPARTY (PIVOT)', job, '-> перевод выполнен');
    return job.complete({ status: 'TRANSFERRED' });
  },
});

// 5. Возврат средств - компенсация (повторяемая, обязана дойти)
zbc.createWorker({
  taskType: 'refund-funds',
  taskHandler: async (job) => {
    log('↩️', 'REFUND_FUNDS (compensation)', job, '-> средства возвращены клиенту');
    return job.complete({ status: 'REFUNDED', refunded: true });
  },
});

// 6. Уведомление клиента (успех / возврат)
zbc.createWorker({
  taskType: 'notify-client',
  taskHandler: async (job) => {
    log('📧', 'NOTIFY_CLIENT', job, `status=${job.variables.status || '-'}`);
    return job.complete();
  },
});

// 7. Уведомление службы безопасности
zbc.createWorker({
  taskType: 'notify-security',
  taskHandler: async (job) => {
    log('🚨', 'NOTIFY_SECURITY', job, '-> инцидент передан в безопасность');
    return job.complete();
  },
});

/* Примечание: user task "ManualReview" НЕ обрабатывается здесь -
   он попадает в Camunda Tasklist и завершается оператором вручную. */

/* ------------------------------------------------------------------ */
/*  Запуск платёжного инстанса                                        */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
async function startPayment(scenario, attempts = 1) {
  seq += 1;
  const paymentId = `PAY-${Date.now()}-${seq}`;
  const variables = {
    paymentId,
    orderId: `ORD-${1000 + seq}`,
    amount: 100 + seq,
    scenario: (scenario || 'AUTO').toUpperCase(),
  };
  for (let i = 1; i <= attempts; i++) {
    try {
      const wf = await zbc.createProcessInstance({ bpmnProcessId: PROCESS_ID, variables });
      console.log(`${ts()} 🚀 [START] payment=${paymentId} scenario=${variables.scenario} instanceKey=${wf.processInstanceKey}`);
      return { paymentId, ...wf };
    } catch (e) {
      if (i === attempts) throw e;
      console.log(`${ts()} ⏳ Процесс ещё не задеплоен, повтор ${i}/${attempts}...`);
      await sleep(5000);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  HTTP API (health + ручной запуск)                                 */
/* ------------------------------------------------------------------ */

http.createServer(async (req, res) => {
  if (req.url.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'UP', zeebe: ZEEBE_ADDRESS }));
  }
  if (req.url.startsWith('/start')) {
    const scenario = new URL(req.url, 'http://x').searchParams.get('scenario') || 'AUTO';
    try {
      const r = await startPayment(scenario);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e) }));
    }
  }
  res.writeHead(404);
  res.end('not found');
}).listen(PORT, () => console.log(`${ts()} 🌐 HTTP listening on :${PORT}`));

/* ------------------------------------------------------------------ */
/*  Авто-демо: по одному инстансу на каждый сценарий антифрода         */
/* ------------------------------------------------------------------ */

console.log(`${ts()} ✅ Payment Service запущен, воркеры зарегистрированы (zeebe=${ZEEBE_ADDRESS})`);

if (RUN_DEMO) {
  setTimeout(async () => {
    console.log(`${ts()} ▶️  Запуск демо-сценариев...`);
    try {
      await startPayment('ALLOW', 20);  // успешный поток -> перевод контрагенту
      await startPayment('DENY', 20);   // отказ антифрода -> автоматический возврат
      await startPayment('MANUAL', 20); // ручная проверка -> ждёт оператора в Tasklist
    } catch (e) {
      console.error(`${ts()} ❌ Ошибка запуска демо:`, e);
    }
  }, 15000);
}
