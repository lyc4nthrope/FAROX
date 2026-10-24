// Smoke de punta a punta: recorre los flujos H1–H3 + fiado contra un Supabase
// LOCAL con todas las migraciones, usando las mismas consultas y RPC del front.
// Uso (en una BD local recién reseteada):
//   API_URL=... ANON_KEY=... SERVICE_ROLE_KEY=... DB_CONTAINER=supabase_db_<dir> node scripts/smoke-local.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

// Variables (de `supabase status -o env`): API_URL, ANON_KEY, SERVICE_ROLE_KEY.
// DB_CONTAINER: contenedor de Postgres local (por defecto supabase_db_<carpeta>).
const env = process.env;
for (const k of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_CONTAINER"]) {
  if (!env[k]) {
    console.error(`Falta la variable ${k}`);
    process.exit(2);
  }
}
// Seguridad: este script crea usuarios y datos; jamás contra un proyecto remoto.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL)) {
  console.error("smoke-local solo corre contra un Supabase LOCAL (API_URL en localhost).");
  process.exit(2);
}
const URL_ = env.API_URL;
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", env.DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tAc", q])
    .toString()
    .trim();

const admin = createClient(URL_, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " → " + detail}`);
}
async function user(email) {
  await admin.auth.admin.createUser({ email, password: "Farox-2026!", email_confirm: true });
  const c = createClient(URL_, env.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "Farox-2026!" });
  if (error) throw error;
  return c;
}
const msg = (e) => (e ? e.message : "");

const ad = await user("admin@farox.test");
sql("UPDATE public.users SET role_id=(SELECT id FROM public.roles WHERE name='admin') WHERE email='admin@farox.test'");
const op = await user("op@farox.test");
const op2 = await user("op2@farox.test");
const di = await user("dist@farox.test");

// --- H1 registro y catálogo
const role = await ad.rpc("my_role");
check("admin: my_role = admin", role.data === "admin", JSON.stringify(role));
const st = await op.rpc("create_store", {
  p_name: "Tienda La 14", p_store_type_id: 1, p_address: "Cra 14", p_city: "Armenia",
  p_phone: null, p_location: "SRID=4326;POINT(-75.6811 4.5339)",
});
check("operador crea tienda (create_store)", !st.error && st.data > 0, msg(st.error));
const storeId = st.data;
const st2 = await op2.rpc("create_store", { p_name: "T2a", p_store_type_id: 1, p_location: "SRID=4326;POINT(-75.68 4.53)" });
const st3 = await op2.rpc("create_store", { p_name: "T2b", p_store_type_id: 1, p_location: "SRID=4326;POINT(-75.68 4.54)" });
check("tope de tiendas: 2.ª tienda sin premium falla", !st2.error && !!st3.error && /tope/i.test(msg(st3.error)), msg(st3.error));
const rd = await di.rpc("register_distributor", { p_name: "Distribuidora Quindío", p_nit: "900123456-7" });
check("autoregistro de distribuidor", !rd.error && rd.data > 0, msg(rd.error));
const distId = rd.data;
const rdAdmin = await ad.rpc("register_distributor", { p_name: "X", p_nit: "1" });
check("admin NO puede autodegradarse a distribuidor (0015)", !!rdAdmin.error, "no dio error");
const cats = await op.from("product_categories").select("id").limit(1);
const brands = await op.from("brands").select("id").limit(1);
const units = await op.from("unit_types").select("id").limit(1);
const pr = await op.from("products").insert({
  name: "Arroz Diana 500 g", category_id: cats.data?.[0]?.id, brand_id: brands.data?.[0]?.id,
  unit_type_id: units.data?.[0]?.id, base_quantity: 1, created_by: (await op.auth.getUser()).data.user.id,
}).select("id").single();
check("operador crea producto", !pr.error, msg(pr.error));
const productId = pr.data?.id;

// --- H2 stock
const as = await op.rpc("assign_product_to_store", { p_product: productId, p_store: storeId, p_threshold: 10 });
check("asignar producto con umbral", !as.error, msg(as.error));
const motives = await op.from("motives").select("id,name,suggested_type").eq("is_active", true);
const mEntry = motives.data.find((m) => m.name === "reabastecimiento").id;
const mExit = motives.data.find((m) => m.name === "venta").id;
const e0 = await op.rpc("register_entry", { p_product: productId, p_store: storeId, p_qty: 20, p_motive_id: mEntry, p_order_id: null, p_expiry_date: null });
check("sin premium: entrada bloqueada", !!e0.error && /premium/i.test(msg(e0.error)), msg(e0.error));
const prem = await ad.rpc("set_user_premium", { p_user_id: (await op.auth.getUser()).data.user.id, p_value: true });
check("admin activa premium", !prem.error, msg(prem.error));
const sp = await ad.rpc("set_price", { p_product: productId, p_store: storeId, p_price: 2500, p_currency: "COP" });
check("admin pone precio", !sp.error, msg(sp.error));
const e1 = await op.rpc("register_entry", { p_product: productId, p_store: storeId, p_qty: 20, p_motive_id: mEntry, p_order_id: null, p_expiry_date: null });
check("entrada 20", !e1.error, msg(e1.error));
const x1 = await op.rpc("register_exit", { p_product: productId, p_store: storeId, p_qty: 12, p_motive_id: mExit, p_order_id: null });
check("salida 12", !x1.error, msg(x1.error));
const stock = await op.from("stock").select("product_id,quantity,threshold,expiry_date,product:products(name)").eq("store_id", storeId);
check("stock = 8 (lectura del front con embed)", Number(stock.data?.[0]?.quantity) === 8 && stock.data?.[0]?.product?.name, JSON.stringify(stock));
const al = await op.from("alerts").select("id,type,message,created_at,read_at").is("resolved_at", null);
check("aparece UNA alerta stock_low", al.data?.filter((a) => a.type === "stock_low").length === 1, JSON.stringify(al));
const x2 = await op.rpc("register_exit", { p_product: productId, p_store: storeId, p_qty: 9, p_motive_id: mExit, p_order_id: null });
check("salida 9 → stock insuficiente", /insuficiente/i.test(msg(x2.error)), msg(x2.error));
const mr = await op.rpc("mark_alert_read", { p_alert: al.data?.[0]?.id });
check("marcar alerta leída", !mr.error, msg(mr.error));
await op.rpc("register_entry", { p_product: productId, p_store: storeId, p_qty: 30, p_motive_id: mEntry, p_order_id: null, p_expiry_date: "2026-12-31" });
const al2 = await op.from("alerts").select("id").is("resolved_at", null).eq("type", "stock_low");
check("entrada 30 resuelve la alerta", al2.data?.length === 0, JSON.stringify(al2));
const mv = await op.from("movements").select("id,type,quantity,created_at,reverso_of_id,product:products(name),motive:motives(name)").eq("store_id", storeId).order("created_at", { ascending: false });
check("historial de movimientos (3)", mv.data?.length === 3, JSON.stringify(mv.error ?? mv.data?.length));
const rv = await ad.rpc("register_reverse", { p_movement_id: mv.data?.[0]?.id, p_reason: "prueba" });
check("admin revierte un movimiento", !rv.error, msg(rv.error));

// --- H3 pedidos y logística
const co = await op.rpc("create_order", { p_distributor: distId, p_store: storeId, p_items: [{ product_id: productId, quantity: 24 }], p_expected_at: null, p_notes: "demo" });
check("operador crea pedido", !co.error && co.data > 0, msg(co.error));
const orderId = co.data;
const ir = await op.rpc("update_order_status", { p_order: orderId, p_status: "in_route", p_reason: null });
check("pedido en ruta", !ir.error, msg(ir.error));
const dOrders = await di.from("orders").select("id,status,store_id,expected_at,delivered_at,created_at,notes,cancelled_reason,store:stores(name),distributor:distributors(name)");
check("distribuidor ve SU pedido con embeds", dOrders.data?.length === 1 && dOrders.data[0].store?.name === "Tienda La 14", JSON.stringify(dOrders.error ?? dOrders.data));
const items = await di.rpc("get_order_items", { p_order: orderId });
check("distribuidor (no premium) ve líneas sin precio", items.data?.length === 1 && items.data[0].unit_price == null, JSON.stringify(items));
const before = (await op.from("stock").select("quantity").eq("store_id", storeId).single()).data.quantity;
const cd = await di.rpc("confirm_delivery", { p_order: orderId, p_items: [{ product_id: productId, received_quantity: 20 }] });
check("distribuidor confirma entrega parcial", !cd.error, msg(cd.error));
const after = (await op.from("stock").select("quantity").eq("store_id", storeId).single()).data.quantity;
check("stock sube 20 tras la entrega", Number(after) - Number(before) === 20, `${before} → ${after}`);
const cd2 = await di.rpc("confirm_delivery", { p_order: orderId, p_items: [{ product_id: productId, received_quantity: 20 }] });
check("doble confirmación rechazada", !!cd2.error, "no dio error");
const today = new Date().toLocaleDateString("en-CA");
const sr = await ad.rpc("save_route", { p_distributor: distId, p_route_date: today, p_stops: [{ store_id: storeId, stop_order: 1, estimated_time: "09:00" }] });
check("admin planifica ruta", !sr.error, msg(sr.error));
const myRoute = await di.from("routes").select("id,route_date,status,distributor:distributors(name),route_stops(id,stop_order,status,estimated_time,arrived_at,store_id,store:stores(name))").eq("route_date", today).neq("status", "cancelled").limit(1).maybeSingle();
check("distribuidor ve su ruta de hoy con paradas", myRoute.data?.route_stops?.length === 1, JSON.stringify(myRoute.error ?? myRoute.data));
const geo = await di.from("stores_geo").select("id,lat,lng").in("id", [storeId]);
check("coordenadas desde stores_geo (lat 4.5339)", Math.abs(Number(geo.data?.[0]?.lat) - 4.5339) < 1e-4, JSON.stringify(geo));
const ms = await di.rpc("mark_stop", { p_stop: myRoute.data?.route_stops?.[0]?.id, p_status: "arrived" });
check("distribuidor marca llegada", !ms.error, msg(ms.error));
const ra = await ad.rpc("update_route_status", { p_route: myRoute.data?.id, p_status: "active" });
check("admin inicia la ruta", !ra.error, msg(ra.error));
const rc = await di.rpc("update_route_status", { p_route: myRoute.data?.id, p_status: "completed" });
check("distribuidor termina la ruta", !rc.error, msg(rc.error));

// --- INV-05: QR tienda ↔ distribuidor (0017)
const code = await op.rpc("get_store_link_code", { p_store: storeId });
check("dueño obtiene el código QR de su tienda", !code.error && typeof code.data === "string" && code.data.length >= 12, msg(code.error));
const leak = await di.from("stores").select("link_code").eq("id", storeId);
check("link_code no es legible por SELECT directo", !!leak.error, JSON.stringify(leak.data));
const notOwner = await op2.rpc("get_store_link_code", { p_store: storeId });
check("otro operador no obtiene el código", !!notOwner.error, "no dio error");
const opLink = await op.rpc("link_distributor_to_store", { p_code: code.data });
check("un operador no puede vincularse", !!opLink.error, "no dio error");
const link = await di.rpc("link_distributor_to_store", { p_code: code.data });
check("distribuidor se vincula con el código", !link.error && link.data === storeId, msg(link.error));
const links = await di.from("store_distributors").select("store_id,distributor_id");
check("distribuidor ve su vínculo", links.data?.length === 1, JSON.stringify(links.error ?? links.data));
const regen = await op.rpc("regenerate_store_link_code", { p_store: storeId });
const old = await di.rpc("link_distributor_to_store", { p_code: code.data });
check("código regenerado invalida el anterior", !regen.error && !!old.error, msg(regen.error));
const storesList = await op.from("stores").select("id,name,city,is_active").limit(5);
check("listado de tiendas sigue funcionando", !storesList.error, msg(storesList.error));

// --- dashboard y fiado
const db = await op.rpc("get_dashboard", { p_from: "2026-01-01", p_to: today });
check("dashboard premium devuelve filas", !db.error && db.data?.length > 0, msg(db.error));
const cc = await ad.rpc("create_credit", { p_order: orderId, p_due_date: null });
check("admin crea crédito sobre pedido entregado", !cc.error, msg(cc.error));
const cr = await op.from("credits").select("id,order_id,total_amount,balance,status,due_date,store:stores(name)");
check("operador ve la cartera", cr.data?.length === 1, JSON.stringify(cr.error ?? cr.data));
const pay = await op.rpc("register_payment", { p_credit: cr.data?.[0]?.id, p_amount: 1000, p_method: "cash" });
check("operador registra pago parcial", !pay.error, msg(pay.error));
const pays = await op.from("credit_payments").select("id,amount,payment_method,paid_at,reverso_of_id").eq("credit_id", cr.data?.[0]?.id);
check("historial de pagos", pays.data?.length === 1, JSON.stringify(pays.error ?? pays.data));

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
