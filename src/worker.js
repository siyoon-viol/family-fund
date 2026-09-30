// 우리집 공금통장 — Cloudflare Worker (정적 화면 + /api + D1)

const MAX_MEMBERS = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api") return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

    let req;
    try { req = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

    if (!env.PASSCODE) return json({ ok: false, error: "passcode_not_set" }, 500);
    if (!(await sameSecret(request.headers.get("x-passcode") || "", env.PASSCODE))) {
      await new Promise((r) => setTimeout(r, 800));
      return json({ ok: false, error: "wrong_passcode" }, 401);
    }

    try {
      switch (req.action) {
        case "load": break;
        case "addTx": await addTx(env.DB, req.tx); break;
        case "addTxs": await addTxs(env.DB, req.txs); break;
        case "updateTx": await updateTx(env.DB, req.id, req.tx); break;
        case "deleteTx": await env.DB.prepare("DELETE FROM tx WHERE id = ?").bind(String(req.id || "")).run(); break;
        case "saveSettings": await saveSettings(env.DB, req.settings); break;
        default: return json({ ok: false, error: "unknown_action" }, 400);
      }
      return json({ ok: true, ...(await readAll(env.DB)) });
    } catch (e) {
      if (e instanceof InputError) return json({ ok: false, error: e.message }, 400);
      console.error(e);
      return json({ ok: false, error: "서버 오류가 났습니다. 잠시 후 다시 시도해 주세요." }, 500);
    }
  },
};

class InputError extends Error {}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function readAll(db) {
  const [tx, members, kv] = await db.batch([
    db.prepare("SELECT id, date, type, category, amount, member_id, month, memo, created_at FROM tx ORDER BY date, created_at"),
    db.prepare("SELECT id, name FROM members ORDER BY sort"),
    db.prepare("SELECT key, value FROM settings"),
  ]);
  const conf = Object.fromEntries(kv.results.map((r) => [r.key, r.value]));
  return {
    settings: {
      members: members.results,
      monthlyDue: Number(conf.monthlyDue) || 0,
      account: { bank: conf.accountBank || "", number: conf.accountNumber || "", holder: conf.accountHolder || "" },
    },
    txs: tx.results.map((r) => ({
      id: r.id, date: r.date, type: r.type, category: r.category, amount: r.amount,
      memberId: r.member_id, month: r.month, memo: r.memo, createdAt: r.created_at,
    })),
  };
}

function cleanTx(t) {
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new InputError("날짜 형식이 올바르지 않습니다.");
  const amount = Math.round(Number(t.amount));
  if (!(amount > 0) || amount > 1e12) throw new InputError("금액이 올바르지 않습니다.");
  return {
    date: t.date,
    type: t.type === "out" ? "out" : "in",
    category: String(t.category || "기타").slice(0, 20),
    amount,
    memberId: t.memberId ? String(t.memberId).slice(0, 20) : null,
    month: cleanMonth(t.month),
    memo: String(t.memo || "").slice(0, 80),
  };
}

// 회비 월: "YYYY-MM" 한 달, 또는 "YYYY-MM~YYYY-MM" 여러 달 (최대 36개월)
function cleanMonth(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4}-(?:0[1-9]|1[0-2]))(?:~(\d{4}-(?:0[1-9]|1[0-2])))?$/);
  if (!m) return null;
  const a = m[1], b = m[2] || a;
  if (b < a) throw new InputError("회비 끝 월이 시작 월보다 빠릅니다.");
  const n = (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5)) - Number(a.slice(5))) + 1;
  if (n > 36) throw new InputError("회비는 한 번에 36개월까지 기록할 수 있어요.");
  return a === b ? a : `${a}~${b}`;
}

async function addTx(db, t) {
  const c = cleanTx(t);
  await db.prepare(
    "INSERT INTO tx (id, date, type, category, amount, member_id, month, memo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), c.date, c.type, c.category, c.amount, c.memberId, c.month, c.memo, Date.now()).run();
}

async function addTxs(db, list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 36) throw new InputError("한 번에 1~36줄까지 기록할 수 있어요.");
  const rows = list.map(cleanTx);
  const now = Date.now();
  await db.batch(rows.map((c, i) => db.prepare(
    "INSERT INTO tx (id, date, type, category, amount, member_id, month, memo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), c.date, c.type, c.category, c.amount, c.memberId, c.month, c.memo, now + i)));
}

async function updateTx(db, id, t) {
  const c = cleanTx(t);
  const r = await db.prepare(
    "UPDATE tx SET date = ?, type = ?, category = ?, amount = ?, member_id = ?, month = ?, memo = ? WHERE id = ?"
  ).bind(c.date, c.type, c.category, c.amount, c.memberId, c.month, c.memo, String(id || "")).run();
  if (!r.meta.changes) throw new InputError("수정할 기록을 찾지 못했습니다. 다른 가족이 먼저 삭제했을 수 있어요.");
}

async function saveSettings(db, s) {
  const members = (s && Array.isArray(s.members) ? s.members : [])
    .filter((m) => m && m.id && String(m.name || "").trim())
    .slice(0, MAX_MEMBERS);
  const due = Math.max(0, Math.round(Number(s && s.monthlyDue) || 0));
  const upsert = (key, value) =>
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value);
  const acc = s && s.account && typeof s.account === "object" ? s.account : null;
  await db.batch([
    ...(acc ? [
      upsert("accountBank", String(acc.bank || "").trim().slice(0, 30)),
      upsert("accountNumber", String(acc.number || "").replace(/[^\d-]/g, "").slice(0, 30)),
      upsert("accountHolder", String(acc.holder || "").trim().slice(0, 30)),
    ] : []),
    db.prepare("DELETE FROM members"),
    ...members.map((m, i) =>
      db.prepare("INSERT INTO members (id, name, sort) VALUES (?, ?, ?)")
        .bind(String(m.id).slice(0, 20), String(m.name).trim().slice(0, 20), i)),
    db.prepare("INSERT INTO settings (key, value) VALUES ('monthlyDue', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(due)),
  ]);
}
