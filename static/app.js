const state = { branding: null, teachers: [], attendance: [] };

const els = {
  brandName: document.getElementById("brandName"),
  brandSubtitle: document.getElementById("brandSubtitle"),
  logoPreview: document.getElementById("logoPreview"),
  institutionName: document.getElementById("institutionName"),
  institutionSubtitle: document.getElementById("institutionSubtitle"),
  primaryColor: document.getElementById("primaryColor"),
  accentColor: document.getElementById("accentColor"),
  brandingForm: document.getElementById("brandingForm"),
  teacherForm: document.getElementById("teacherForm"),
  teacherName: document.getElementById("teacherName"),
  teacherDocument: document.getElementById("teacherDocument"),
  teacherArea: document.getElementById("teacherArea"),
  teachersList: document.getElementById("teachersList"),
  attendanceTable: document.getElementById("attendanceTable"),
  scanForm: document.getElementById("scanForm"),
  scanCode: document.getElementById("scanCode"),
  liveClock: document.getElementById("liveClock"),
  teacherCardTemplate: document.getElementById("teacherCardTemplate"),
  startCameraBtn: document.getElementById("startCameraBtn"),
  stopCameraBtn: document.getElementById("stopCameraBtn"),
  cameraPreview: document.getElementById("cameraPreview"),
  cameraStatus: document.getElementById("cameraStatus"),
};

let cameraStream = null;
let cameraLoopId = null;
let cameraBusy = false;
let lastDetectedCode = "";
let lastDetectedAt = 0;

init();

async function init() {
  await bootstrap();
  wireEvents();
  updateClock();
  setInterval(updateClock, 1000);
}

async function bootstrap() {
  const response = await fetch("/api/bootstrap");
  const data = await response.json();
  state.branding = data.branding;
  state.teachers = data.teachers;
  state.attendance = data.attendance;
  applyBranding();
  hydrateBrandingForm();
  renderTeachers();
  renderAttendance();
}

function wireEvents() {
  els.brandingForm.addEventListener("submit", onBrandingSubmit);
  els.teacherForm.addEventListener("submit", onTeacherSubmit);
  els.scanForm.addEventListener("submit", onScanSubmit);
  els.startCameraBtn.addEventListener("click", startCameraScanner);
  els.stopCameraBtn.addEventListener("click", stopCameraScanner);
}

async function onBrandingSubmit(event) {
  event.preventDefault();
  const params = new URLSearchParams({
    institution_name: els.institutionName.value.trim(),
    subtitle: els.institutionSubtitle.value.trim(),
    primary_color: els.primaryColor.value,
    accent_color: els.accentColor.value,
    logo_url: document.getElementById("logoInput").value.trim(),
  });
  const response = await fetch("/api/branding", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!response.ok) {
    alert("No se pudo guardar la personalización");
    return;
  }
  await bootstrap();
}

async function onTeacherSubmit(event) {
  event.preventDefault();
  const payload = {
    full_name: els.teacherName.value.trim(),
    document_code: els.teacherDocument.value.trim(),
    area: els.teacherArea.value.trim(),
  };

  const response = await fetch("/api/teachers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json();
    alert(data.error || "No se pudo registrar el docente");
    return;
  }

  els.teacherForm.reset();
  await bootstrap();
}

async function onScanSubmit(event) {
  event.preventDefault();
  const code = els.scanCode.value.trim();
  if (!code) return;

  const response = await fetch("/api/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unique_code: code, attendance_type: "AUTO" }),
  });

  if (!response.ok) {
    const data = await response.json();
    alert(data.error || "Código no válido");
    return;
  }

  els.scanForm.reset();
  await bootstrap();
}

async function registerManual(uniqueCode, type) {
  await fetch("/api/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unique_code: uniqueCode, attendance_type: type }),
  });
  await bootstrap();
}

function applyBranding() {
  const b = state.branding;
  els.brandName.textContent = b.institution_name;
  els.brandSubtitle.textContent = b.subtitle;
  document.documentElement.style.setProperty("--primary", b.primary_color);
  document.documentElement.style.setProperty("--accent", b.accent_color);

  if (b.logo_url) {
    els.logoPreview.src = `${b.logo_url}?t=${Date.now()}`;
    els.logoPreview.style.display = "block";
  } else {
    els.logoPreview.style.display = "none";
  }
}

function hydrateBrandingForm() {
  const b = state.branding;
  els.institutionName.value = b.institution_name;
  els.institutionSubtitle.value = b.subtitle;
  els.primaryColor.value = b.primary_color;
  els.accentColor.value = b.accent_color;
  document.getElementById("logoInput").value = b.logo_url || "";
}

function renderTeachers() {
  els.teachersList.innerHTML = "";
  state.teachers.forEach((teacher) => {
    const node = els.teacherCardTemplate.content.cloneNode(true);
    const card = node.querySelector(".card");
    node.querySelector("h3").textContent = teacher.full_name;
    node.querySelector(".doc").textContent = `Documento: ${teacher.document_code}`;
    node.querySelector(".area").textContent = `Área: ${teacher.area || "sin especificar"}`;
    node.querySelector(".code").textContent = `Código único: ${teacher.unique_code}`;

    drawPseudoQR(node.querySelector(".qr"), teacher.unique_code);
    drawPseudoBarcode(node.querySelector(".barcode"), teacher.unique_code);

    card.querySelector('[data-action="entry"]').onclick = () => registerManual(teacher.unique_code, "ENTRADA");
    card.querySelector('[data-action="exit"]').onclick = () => registerManual(teacher.unique_code, "SALIDA");

    els.teachersList.appendChild(node);
  });
}

function renderAttendance() {
  els.attendanceTable.innerHTML = "";
  state.attendance.forEach((record) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTime(record.happened_at)}</td>
      <td>${record.teacher_name}</td>
      <td>${record.attendance_type}</td>
      <td>${record.unique_code}</td>
    `;
    els.attendanceTable.appendChild(tr);
  });
}

function formatDateTime(isoDate) {
  return new Date(isoDate).toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function updateClock() {
  els.liveClock.textContent = new Date().toLocaleString("es-CO", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}




async function startCameraScanner() {
  if (!("BarcodeDetector" in window)) {
    els.cameraStatus.textContent = "Tu navegador no soporta escaneo QR con BarcodeDetector.";
    return;
  }

  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });

    els.cameraPreview.srcObject = cameraStream;
    await els.cameraPreview.play();
    els.cameraStatus.textContent = "Cámara activa. Apunta al QR del docente.";

    const loop = async () => {
      if (!cameraStream) return;
      if (!cameraBusy) {
        cameraBusy = true;
        try {
          const barcodes = await detector.detect(els.cameraPreview);
          if (barcodes.length > 0) {
            const raw = String(barcodes[0].rawValue || "").trim();
            const now = Date.now();
            if (raw && (raw !== lastDetectedCode || now - lastDetectedAt > 5000)) {
              lastDetectedCode = raw;
              lastDetectedAt = now;
              await registerByQRCode(raw);
            }
          }
        } catch (_err) {
          // Ignorar errores intermitentes de frames.
        } finally {
          cameraBusy = false;
        }
      }
      cameraLoopId = requestAnimationFrame(loop);
    };

    cameraLoopId = requestAnimationFrame(loop);
  } catch (_err) {
    els.cameraStatus.textContent = "No se pudo activar la cámara. Revisa permisos del navegador.";
  }
}

function stopCameraScanner() {
  if (cameraLoopId) {
    cancelAnimationFrame(cameraLoopId);
    cameraLoopId = null;
  }
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  els.cameraPreview.srcObject = null;
  els.cameraStatus.textContent = "Cámara inactiva.";
}

async function registerByQRCode(uniqueCode) {
  const response = await fetch("/api/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unique_code: uniqueCode, attendance_type: "AUTO" }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    els.cameraStatus.textContent = data.error || "QR detectado, pero no se pudo registrar asistencia.";
    return;
  }

  const data = await response.json();
  els.cameraStatus.textContent = `Registro automático: ${data.teacher_name} - ${data.attendance_type} (${formatDateTime(data.happened_at)})`;
  await bootstrap();
}
function drawPseudoQR(canvas, text) {
  const ctx = canvas.getContext("2d");
  const size = 110;
  canvas.width = size; canvas.height = size;
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,size,size);
  ctx.fillStyle = "#111";
  let seed = 0;
  for (const ch of text) seed += ch.charCodeAt(0);
  for (let y=0; y<11; y++) {
    for (let x=0; x<11; x++) {
      const bit = (x*y + seed + x + y) % 3 === 0;
      if (bit) ctx.fillRect(x*10, y*10, 9, 9);
    }
  }
}

function drawPseudoBarcode(svg, text) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute("viewBox", "0 0 160 70");
  svg.setAttribute("width", "150");
  svg.setAttribute("height", "70");
  let x = 4;
  for (const ch of text) {
    const w = (ch.charCodeAt(0) % 3) + 1;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", "8");
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", "46");
    rect.setAttribute("fill", "#111");
    svg.appendChild(rect);
    x += w + 2;
    if (x > 154) break;
  }
}
