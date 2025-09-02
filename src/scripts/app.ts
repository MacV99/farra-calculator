// ---------- Tipos ----------
type Producto = {
  id: string;
  nombre: string;
  precioUnidadCOP: number;
  cantidad: number;
  abv: number; // 0-100
  mlUnidad: number;
};

type Resumen = {
  costoTotalCOP: number;
  costoPorPersonaCOP: number;
  volumenTotalMl: number;
  volumenTotalL: number;
  alcoholPuroTotalMl: number;
  alcoholPuroPorPersonaMl: number;
};

type Evento = {
  id: string;
  nombreEvento: string;
  fechaISO: string;
  personas: number;
  productos: Producto[];
  resumen: Resumen;
};

// ---------- Constantes ----------
const LS = {
  personas: "fiesta.personas",
  productos: "fiesta.productos",
  eventos: "fiesta.eventos",
  eventoActivoId: "fiesta.eventoActivoId",
} as const;

const fmtCOP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---------- Estado ----------
let personas = 1;
let productos: Producto[] = [];
let eventoActivoId: string | null = null;
let editingId: string | null = null;
let lastFocusSel: string | null = null;

// control de cambios sin guardar
let dirty = false;
let lastSavedSnapshot = "";

// ---------- Utils ----------
const uuid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));

const todayISO = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const n = (v: any) => Number(v ?? 0);

const snapshotState = () => JSON.stringify({ personas, productos });
function updateSnapshot() { lastSavedSnapshot = snapshotState(); dirty = false; updateSaveDirtyIndicator(); }
function markDirty() { const now = snapshotState(); dirty = now !== lastSavedSnapshot; updateSaveDirtyIndicator(); }
function updateSaveDirtyIndicator() {
  const btn = $("#btn-guardar-cambios") as HTMLButtonElement;
  if (!btn) return;
  btn.textContent = dirty ? "Guardar *" : "Guardar";
}

// ---------- Toast ----------
let toastTimer: number | null = null;
function showToast(msg: string) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  if (toastTimer) { window.clearTimeout(toastTimer); }
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 1600);
}

// ---------- Modal genérico (confirm/save/discard) ----------
const dialog = {
  open(opts: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    extraText?: string; // tercer botón (p.ej. "Descartar")
  }): Promise<"confirm" | "cancel" | "extra"> {
    const overlay = document.getElementById("dialog-overlay") as HTMLDivElement;
    const title = document.getElementById("dialog-title") as HTMLElement;
    const msg = document.getElementById("dialog-message") as HTMLElement;

    const btnConfirm = document.getElementById("dialog-confirm") as HTMLButtonElement;
    const btnCancel = document.getElementById("dialog-cancel") as (HTMLButtonElement | null); // <-- puede no existir
    const btnExtra = document.getElementById("dialog-extra") as HTMLButtonElement;
    const btnClose = document.getElementById("dialog-close") as HTMLButtonElement;

    title.textContent = opts.title;
    msg.textContent = opts.message;

    btnConfirm.textContent = opts.confirmText ?? "Confirmar";

    // Si no hay botón cancelar en el DOM, no intentamos usarlo
    if (btnCancel) {
      btnCancel.textContent = opts.cancelText ?? "Cancelar";
      btnCancel.classList.remove("hidden");
    }

    if (opts.extraText) {
      btnExtra.textContent = opts.extraText;
      btnExtra.classList.remove("hidden");
    } else {
      btnExtra.classList.add("hidden");
    }

    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    btnConfirm.focus();

    return new Promise((resolve) => {
      const cleanup = () => {
        overlay.classList.remove("open");
        overlay.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");

        btnConfirm.removeEventListener("click", onConfirm);
        btnExtra.removeEventListener("click", onExtra);
        btnClose.removeEventListener("click", onCancel);
        overlay.removeEventListener("click", onOutside);
        document.removeEventListener("keydown", onEsc);

        // Solo quitamos listeners si el botón existía
        if (btnCancel) btnCancel.removeEventListener("click", onCancel);
      };

      const onConfirm = () => { cleanup(); resolve("confirm"); };
      const onCancel  = () => { cleanup(); resolve("cancel");  };
      const onExtra   = () => { cleanup(); resolve("extra");   };
      const onOutside = (e: Event) => { if (e.target === overlay) onCancel(); };
      const onEsc     = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };

      btnConfirm.addEventListener("click", onConfirm);
      btnExtra.addEventListener("click", onExtra);
      btnClose.addEventListener("click", onCancel);
      overlay.addEventListener("click", onOutside);
      document.addEventListener("keydown", onEsc);

      // Solo agregamos listener si existe el botón
      if (btnCancel) btnCancel.addEventListener("click", onCancel);
    });
  },
};


// wrapper para preguntar por cambios sin guardar
function guardUnsavedThen(proceed: () => void) {
  if (!dirty) { proceed(); return; }

  if (!eventoActivoId) {
    // Borrador sin evento activo: solo podemos descartar o cancelar
    dialog.open({
      title: "Cambios sin guardar",
      message: "Tienes cambios en el borrador. ¿Descartar los cambios?",
      confirmText: "Descartar",
      cancelText: "Cancelar",
    }).then(res => {
      if (res === "confirm") proceed();
    });
    return;
  }

  dialog.open({
    title: "Cambios sin guardar",
    message: "¿Quieres guardar los cambios del evento actual antes de continuar?",
    confirmText: "Guardar y continuar",
    extraText: "Descartar",
    cancelText: "Cancelar",
  }).then(res => {
    if (res === "confirm") {
      onGuardarCambios();
      proceed();
    } else if (res === "extra") {
      proceed();
    }
  });
}

// ---------- Cálculos ----------
function calcularResumen(pers: number, items: Producto[]): Resumen {
  const costo_total = items.reduce((acc, p) => acc + p.precioUnidadCOP * p.cantidad, 0);
  const volumen_total_ml = items.reduce((acc, p) => acc + p.cantidad * p.mlUnidad, 0);
  const alcohol_puro_total_ml = items.reduce((acc, p) => acc + p.cantidad * p.mlUnidad * (p.abv / 100), 0);

  const costo_por_persona = pers > 0 ? costo_total / pers : 0;
  const ml_alcohol_puro_por_persona = pers > 0 ? alcohol_puro_total_ml / pers : 0;
  const volumen_total_litros = volumen_total_ml / 1000;

  return {
    costoTotalCOP: Math.round(costo_total),
    costoPorPersonaCOP: Math.round(costo_por_persona),
    volumenTotalMl: Math.round(volumen_total_ml),
    volumenTotalL: +volumen_total_litros.toFixed(2),
    alcoholPuroTotalMl: Math.round(alcohol_puro_total_ml),
    alcoholPuroPorPersonaMl: Math.round(ml_alcohol_puro_por_persona),
  };
}

// ---------- Persistencia ----------
function loadEventos(): Evento[] { try { return JSON.parse(localStorage.getItem(LS.eventos) || "[]"); } catch { return []; } }
function saveEventos(evts: Evento[]) { localStorage.setItem(LS.eventos, JSON.stringify(evts)); }
function setEventoActivo(id: string | null) {
  eventoActivoId = id;
  const saveBtn = $("#btn-guardar-cambios") as HTMLButtonElement;
  if (id) {
    localStorage.setItem(LS.eventoActivoId, id);
    saveBtn.disabled = false;
  } else {
    localStorage.removeItem(LS.eventoActivoId);
    saveBtn.disabled = true;
  }
  renderTituloEventoActual();
}
function persistEstadoActual() {
  localStorage.setItem(LS.personas, String(personas));
  localStorage.setItem(LS.productos, JSON.stringify(productos));
}

function seedEjemplo() {
  personas = 10;
  productos = [
    { id: uuid(), nombre: "Cerveza 330 ml", precioUnidadCOP: 5000, cantidad: 24, abv: 4.5, mlUnidad: 330 },
    { id: uuid(), nombre: "Ron 750 ml", precioUnidadCOP: 60000, cantidad: 2, abv: 35, mlUnidad: 750 },
    { id: uuid(), nombre: "Vino 750 ml", precioUnidadCOP: 45000, cantidad: 2, abv: 12, mlUnidad: 750 },
  ];
}

function loadEstadoInicial() {
  const activo = localStorage.getItem(LS.eventoActivoId);
  if (activo) {
    const evts = loadEventos();
    const found = evts.find((e) => e.id === activo);
    if (found) {
      personas = found.personas;
      productos = found.productos;
      setEventoActivo(activo);
      updateSnapshot();
      return;
    } else {
      setEventoActivo(null);
    }
  }
  const pStr = localStorage.getItem(LS.personas);
  const prodsStr = localStorage.getItem(LS.productos);
  if (pStr && prodsStr) {
    personas = Math.max(1, parseInt(pStr, 10) || 1);
    try { productos = JSON.parse(prodsStr) || []; } catch { productos = []; }
    updateSnapshot();
    return;
  }
  seedEjemplo();
  updateSnapshot();
}

// ---------- Render ----------
function renderPersonas() { ($("#personas") as HTMLInputElement).value = String(personas); }

function renderTituloEventoActual() {
  const h2 = document.querySelector<HTMLHeadingElement>("#evento-nombre-heading")!;
  const fecha = document.querySelector<HTMLElement>("#evento-fecha")!;
  const evts = loadEventos();
  const actual = evts.find(e => e.id === eventoActivoId);
  if (actual) {
    h2.textContent = actual.nombreEvento || "(Sin evento)";
    fecha.textContent = actual.fechaISO || "—";
  } else {
    h2.textContent = "Borrador sin guardar";
    fecha.textContent = "—";
  }
}

function renderProductos() {
  const tbody = $("#tbody-productos");
  const vacio = $("#estado-vacio");
  tbody.innerHTML = "";
  productos.length === 0 ? vacio.classList.remove("hidden") : vacio.classList.add("hidden");

  for (const p of productos) {
    const costoLinea = p.precioUnidadCOP * p.cantidad;
    const tr = document.createElement("tr");
    tr.dataset.id = p.id;
    tr.innerHTML = `
      <td data-label="Nombre"><span class="nombre">${p.nombre}</span></td>
      <td data-label="Precio x unidad">${fmtCOP.format(p.precioUnidadCOP)}</td>
      <td data-label="Cantidad">${p.cantidad}</td>
      <td data-label="%ABV">${p.abv}%</td>
      <td data-label="ml/unidad">${p.mlUnidad}</td>
      <td data-label="Costo línea">${fmtCOP.format(costoLinea)}</td>
      <td data-label="Acciones">
        <div class="actions-row">
          <button type="button" class="btn secondary btn-editar" aria-label="Editar"><i class="bi bi-pen-fill" aria-hidden="true"></i></button>
          <button type="button" class="btn danger btn-eliminar" aria-label="Eliminar"><i class="bi bi-trash3-fill" aria-hidden="true"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function renderResultados() {
  const res = calcularResumen(personas, productos);
  const el = $("#resultado");
  el.innerHTML = `
    <div class="box">
      <strong>Costos</strong>
      <div class="line"><span class="label">Total</span><span>${fmtCOP.format(res.costoTotalCOP)}</span></div>
      <div class="line"><span class="label">Por persona</span><span>${fmtCOP.format(res.costoPorPersonaCOP)}</span></div>
    </div>
    <div class="box">
      <strong>Alcohol puro</strong>
      <div class="line"><span class="label">Total</span><span>${res.alcoholPuroTotalMl} ml</span></div>
      <div class="line"><span class="label">Por persona</span><span>${res.alcoholPuroPorPersonaMl} ml</span></div>
    </div>
    <div class="box">
      <strong>Volumen total</strong>
      <div class="line"><span class="label">Total</span><span>${res.volumenTotalMl} ml · ${res.volumenTotalL} L</span></div>
    </div>
  `;
  $("#live-region").textContent =
    `Actualizado: total ${fmtCOP.format(res.costoTotalCOP)}, por persona ${fmtCOP.format(res.costoPorPersonaCOP)}, alcohol por persona ${res.alcoholPuroPorPersonaMl} ml.`;
}

function renderEventosLista() {
  const cont = $("#eventos-lista");
  const evts = loadEventos();
  cont.innerHTML = evts.length ? "" : `<p class="muted">No hay eventos guardados.</p>`;
  for (const e of evts) {
    const isActive = eventoActivoId === e.id ? "active" : "";
    cont.innerHTML += `
      <div class="evento-item ${isActive}" data-id="${e.id}">
        <div class="meta">
          <strong>${e.nombreEvento || "(Sin título)"}</strong>
          <span class="muted">${e.fechaISO}</span>
          <span class="muted">Total: ${fmtCOP.format(e.resumen.costoTotalCOP)} | ${e.personas}</span>
        </div>
        <div class="evento-actions">
          <button type="button" class="btn secondary btn-cargar">Abrir</button>
          <button type="button" class="btn danger btn-borrar" aria-label="Eliminar"><i class="bi bi-trash3-fill" aria-hidden="true"></i></button>
        </div>
      </div>
    `;
  }
}

// ---------- Modales (agregar / editar / crear) ----------
function updateBodyScrollLock() {
  const anyOpen = document.querySelectorAll(".modal-overlay.open").length > 0;
  document.body.classList.toggle("modal-open", anyOpen);
}

const modalAdd = {
  overlay: null as HTMLDivElement | null,
  open() {
    this.overlay = $("#modal-overlay") as HTMLDivElement;
    this.overlay.classList.add("open");
    this.overlay.setAttribute("aria-hidden", "false");
    updateBodyScrollLock();
    ($("#p-nombre") as HTMLInputElement).focus();
  },
  close() {
    if (!this.overlay) return;
    this.overlay.classList.remove("open");
    this.overlay.setAttribute("aria-hidden", "true");
    updateBodyScrollLock();
    ($("#producto-errores") as HTMLElement).textContent = "";
    (["#p-nombre","#p-precio","#p-cantidad","#p-abv","#p-ml"] as const).forEach(sel=>{
      const el = $(sel) as HTMLInputElement; el.value = "";
    });
    ($("#btn-abrir-modal") as HTMLButtonElement).focus();
  }
};

const modalEdit = {
  overlay: null as HTMLDivElement | null,
  open(id: string) {
    editingId = id;
    lastFocusSel = `tr[data-id="${id}"] .btn-editar`;
    const p = productos.find(x => x.id === id);
    if (!p) return;
    this.overlay = $("#modal-edit-overlay") as HTMLDivElement;
    ($("#ep-nombre") as HTMLInputElement).value = p.nombre;
    ($("#ep-precio") as HTMLInputElement).value = String(p.precioUnidadCOP);
    ($("#ep-cantidad") as HTMLInputElement).value = String(p.cantidad);
    ($("#ep-abv") as HTMLInputElement).value = String(p.abv);
    ($("#ep-ml") as HTMLInputElement).value = String(p.mlUnidad);
    ($("#edit-errores") as HTMLElement).textContent = "";
    this.overlay.classList.add("open");
    this.overlay.setAttribute("aria-hidden", "false");
    updateBodyScrollLock();
    ($("#ep-nombre") as HTMLInputElement).focus();
  },
  close() {
    if (!this.overlay) return;
    this.overlay.classList.remove("open");
    this.overlay.setAttribute("aria-hidden", "true");
    updateBodyScrollLock();
    ($("#edit-errores") as HTMLElement).textContent = "";
    if (lastFocusSel) document.querySelector<HTMLButtonElement>(lastFocusSel)?.focus();
    editingId = null;
    lastFocusSel = null;
  }
};

const modalCreate = {
  overlay: null as HTMLDivElement | null,
  open() {
    this.overlay = $("#modal-create-overlay") as HTMLDivElement;
    ($("#ce-nombre") as HTMLInputElement).value = "";
    ($("#ce-fecha") as HTMLInputElement).value = todayISO();
    ($("#create-errores") as HTMLElement).textContent = "";
    this.overlay.classList.add("open");
    this.overlay.setAttribute("aria-hidden", "false");
    updateBodyScrollLock();
    ($("#ce-nombre") as HTMLInputElement).focus();
  },
  close() {
    if (!this.overlay) return;
    this.overlay.classList.remove("open");
    this.overlay.setAttribute("aria-hidden", "true");
    updateBodyScrollLock();
    ($("#btn-crear-evento") as HTMLButtonElement).focus();
  }
};

// ---------- Handlers ----------
function onAddProducto(e: Event) {
  e.preventDefault();
  const nombre = ($("#p-nombre") as HTMLInputElement).value.trim();
  const precio = n(($("#p-precio") as HTMLInputElement).value);
  const cantidad = n(($("#p-cantidad") as HTMLInputElement).value);
  const abv = n(($("#p-abv") as HTMLInputElement).value);
  const ml = n(($("#p-ml") as HTMLInputElement).value);
  const err = $("#producto-errores");

  if (!nombre) { err.textContent = "El nombre es obligatorio."; return; }
  if (precio < 0 || cantidad < 0 || ml < 0 || abv < 0 || abv > 100 ||
      [precio,cantidad,ml,abv].some(Number.isNaN)) {
    err.textContent = "Revisa valores: no negativos, sin NaN y %ABV ≤ 100.";
    return;
  }
  err.textContent = "";

  productos.push({ id: uuid(), nombre, precioUnidadCOP: precio, cantidad, abv, mlUnidad: ml });
  persistEstadoActual();
  renderProductos();
  renderResultados();
  markDirty();
  modalAdd.close();
}

function onEditProductoSubmit(e: Event) {
  e.preventDefault();
  if (!editingId) return;

  const nombre = ($("#ep-nombre") as HTMLInputElement).value.trim();
  const precio = n(($("#ep-precio") as HTMLInputElement).value);
  const cantidad = n(($("#ep-cantidad") as HTMLInputElement).value);
  const abv = n(($("#ep-abv") as HTMLInputElement).value);
  const ml = n(($("#ep-ml") as HTMLInputElement).value);
  const err = $("#edit-errores");

  if (!nombre) { err.textContent = "El nombre es obligatorio."; return; }
  if (precio < 0 || cantidad < 0 || ml < 0 || abv < 0 || abv > 100 ||
      [precio,cantidad,ml,abv].some(Number.isNaN)) {
    err.textContent = "Revisa valores: no negativos, sin NaN y %ABV ≤ 100.";
    return;
  }
  err.textContent = "";

  const idx = productos.findIndex(p => p.id === editingId);
  if (idx === -1) { modalEdit.close(); return; }
  productos[idx] = { ...productos[idx], nombre, precioUnidadCOP: precio, cantidad, abv, mlUnidad: ml };
  persistEstadoActual();
  renderProductos();
  renderResultados();
  markDirty();
  modalEdit.close();
}

function onCrearEventoSubmit(e: Event) {
  e.preventDefault();
  const nombreEvento = ($("#ce-nombre") as HTMLInputElement).value.trim();
  const fechaISO = ($("#ce-fecha") as HTMLInputElement).value || todayISO();

  // Resetear estado
  personas = 1;
  productos = [];
  persistEstadoActual();
  renderPersonas(); renderProductos(); renderResultados();

  // Guardar stub
  const resumen = calcularResumen(personas, productos);
  const evt: Evento = { id: uuid(), nombreEvento, fechaISO, personas, productos: [], resumen };
  const evts = loadEventos();
  evts.unshift(evt);
  saveEventos(evts);
  setEventoActivo(evt.id);
  renderEventosLista();
  updateSnapshot(); // nuevo evento limpio
  modalCreate.close();
}

function onGuardarCambios() {
  if (!eventoActivoId) return;
  const evts = loadEventos();
  const idx = evts.findIndex(e => e.id === eventoActivoId);
  if (idx === -1) return;

  const resumen = calcularResumen(personas, productos);
  evts[idx] = { ...evts[idx], personas, productos: structuredClone(productos), resumen };
  saveEventos(evts);
  renderEventosLista();
  updateSnapshot();
  showToast("Guardado correctamente");
}

function onPersonasInput() {
  const val = Math.max(1, parseInt(($("#personas") as HTMLInputElement).value, 10) || 1);
  personas = val;
  persistEstadoActual();
  renderResultados();
  markDirty();
}

function onTablaClick(e: Event) {
  const target = e.target as HTMLElement;
  const btn = target.closest("button");
  if (!btn) return;
  const tr = btn.closest("tr") as HTMLTableRowElement | null;
  if (!tr) return;
  const id = tr.dataset.id!;
  const idx = productos.findIndex((x) => x.id === id);
  if (idx === -1) return;

  if (btn.classList.contains("btn-eliminar")) {
    // Confirmar con modal
    dialog.open({
      title: "Eliminar producto",
      message: "¿Seguro que quieres eliminar este producto?",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
    }).then(res => {
      if (res !== "confirm") return;
      productos.splice(idx, 1);
      persistEstadoActual();
      renderProductos();
      renderResultados();
      markDirty();
    });
    return;
  }
  if (btn.classList.contains("btn-editar")) {
    modalEdit.open(id);
    return;
  }
}

function onLimpiar() {
  dialog.open({
    title: "Limpiar todo",
    message: "Esto limpiará personas y productos actuales (no borra los eventos guardados).",
    confirmText: "Sí, limpiar",
    cancelText: "Cancelar",
  }).then(res => {
    if (res !== "confirm") return;
    // No cambiamos el evento activo; simplemente limpiamos el estado
    personas = 1;
    productos = [];
    persistEstadoActual();
    renderPersonas();
    renderProductos();
    renderResultados();
    markDirty();
  });
}

function onEventosClick(e: Event) {
  const target = e.target as HTMLElement;
  const item = target.closest(".evento-item") as HTMLElement | null;
  if (!item) return;
  const id = item.dataset.id!;
  const evts = loadEventos();
  const found = evts.find((x) => x.id === id);
  if (!found) return;

  if (target.closest(".btn-cargar")) {
    guardUnsavedThen(() => {
      personas = found.personas;
      productos = structuredClone(found.productos);
      setEventoActivo(found.id);
      persistEstadoActual();
      renderPersonas();
      renderProductos();
      renderResultados();
      renderEventosLista();
      updateSnapshot();
    });
    return;
  }

  if (target.closest(".btn-borrar")) {
    dialog.open({
      title: "Eliminar evento",
      message: "¿Eliminar este evento? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
    }).then(res => {
      if (res !== "confirm") return;
      const nuevos = evts.filter((x) => x.id !== id);
      saveEventos(nuevos);
      if (eventoActivoId === id) { setEventoActivo(null); updateSnapshot(); }
      renderEventosLista();
    });
    return;
  }
}

// ---------- Init ----------
function init() {
  loadEstadoInicial();

  renderPersonas();
  renderProductos();
  renderResultados();
  renderEventosLista();
  renderTituloEventoActual();
  updateSaveDirtyIndicator();

  // Listeners principales
  $("#tabla-productos").addEventListener("click", onTablaClick);
  $("#personas").addEventListener("input", onPersonasInput);
  $("#btn-limpiar").addEventListener("click", onLimpiar);

  // Modal agregar
  $("#btn-abrir-modal").addEventListener("click", () => modalAdd.open());
  $("#modal-cerrar").addEventListener("click", () => modalAdd.close());
  $("#modal-overlay").addEventListener("click", (e) => { if (e.target === $("#modal-overlay")) modalAdd.close(); });
  $("#form-producto").addEventListener("submit", onAddProducto);

  // Modal editar
  $("#modal-edit-cerrar").addEventListener("click", () => modalEdit.close());
  $("#modal-edit-overlay").addEventListener("click", (e) => { if (e.target === $("#modal-edit-overlay")) modalEdit.close(); });
  $("#form-producto-editar").addEventListener("submit", onEditProductoSubmit);

  // Modal crear evento (si hay cambios, pregunta antes)
  $("#btn-crear-evento").addEventListener("click", () => {
    guardUnsavedThen(() => modalCreate.open());
  });
  $("#modal-create-cerrar").addEventListener("click", () => modalCreate.close());
  $("#modal-create-overlay").addEventListener("click", (e) => { if (e.target === $("#modal-create-overlay")) modalCreate.close(); });
  $("#form-evento-crear").addEventListener("submit", onCrearEventoSubmit);

  // Guardar cambios
  $("#btn-guardar-cambios").addEventListener("click", onGuardarCambios);

  // Lista de eventos
  $("#eventos-lista").addEventListener("click", onEventosClick);

  // Esc cierra modales activos
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const overlays = [ "#modal-edit-overlay", "#modal-overlay", "#modal-create-overlay", "#dialog-overlay" ];
    for (const sel of overlays) {
      const el = document.querySelector(sel);
      if (el && el.classList.contains("open")) {
        (sel === "#modal-edit-overlay") ? modalEdit.close()
        : (sel === "#modal-overlay") ? modalAdd.close()
        : (sel === "#modal-create-overlay") ? modalCreate.close()
        : el.classList.remove("open");
        if (sel === "#dialog-overlay") { el.setAttribute("aria-hidden", "true"); updateBodyScrollLock(); }
        return;
      }
    }
  });

  // Aviso nativo al cerrar pestaña si hay cambios
  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = ""; // muestra el diálogo nativo del navegador
  });
}

document.addEventListener("DOMContentLoaded", init);
