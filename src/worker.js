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
  const [tx, members, due] = await db.batch([
    db.prepare("SELECT id, date, type, category, amount, member_id, month, memo, created_at FROM tx ORDER BY date, created_at"),
    db.prepare("SELECT id, name FROM members ORDER BY sort"),
    db.prepare("SELECT value FROM settings WHERE key = 'monthlyDue'"),
  ]);
  return {
    settings: {
      members: members.results,
      monthlyDue: Number(due.results[0]?.value) || 0,
    },
    txs: tx.results.map((r) => ({
      id: r.id, date: r.date, type: r.type, category: r.category, amount: r.amount,
      memberId: r.member_id, month: r.month, memo: r.memo, createdAt: r.created_at,
    })),
  };
}

async function addTx(db, t) {
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new InputError("날짜 형식이 올바르지 않습니다.");
  const amount = Math.round(Number(t.amount));
  if (!(amount > 0) || amount > 1e12) throw new InputError("금액이 올바르지 않습니다.");
  const type = t.type === "out" ? "out" : "in";
  const month = typeof t.month === "string" && /^\d{4}-\d{2}$/.test(t.month) ? t.month : null;
  await db.prepare(
    "INSERT INTO tx (id, date, type, category, amount, member_id, month, memo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    crypto.randomUUID(), t.date, type, String(t.category || "기타").slice(0, 20), amount,
    t.memberId ? String(t.memberId).slice(0, 20) : null, month, String(t.memo || "").slice(0, 80), Date.now()
  ).run();
}

async function saveSettings(db, s) {
  const members = (s && Array.isArray(s.members) ? s.members : [])
    .filter((m) => m && m.id && String(m.name || "").trim())
    .slice(0, MAX_MEMBERS);
  const due = Math.max(0, Math.round(Number(s && s.monthlyDue) || 0));
  await db.batch([
    db.prepare("DELETE FROM members"),
    ...members.map((m, i) =>
      db.prepare("INSERT INTO members (id, name, sort) VALUES (?, ?, ?)")
        .bind(String(m.id).slice(0, 20), String(m.name).trim().slice(0, 20), i)),
    db.prepare("INSERT INTO settings (key, value) VALUES ('monthlyDue', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(String(due)),
  ]);
}
