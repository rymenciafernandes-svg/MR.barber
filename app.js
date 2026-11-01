/*
  MR. RODOLFO BARBERSHOP
  app.js — Sistema de agendamentos

  Requisitos:
  - index.html
  - style.css
  - config.js
  - Supabase configurado

  As tabelas e funções SQL serão criadas
  na próxima etapa do desenvolvimento.
*/

"use strict";

const $ = (selector) => document.querySelector(selector);

const money = (value) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value) || 0);

const dateBR = (date) => {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
};

const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

const state = {
  user: null,
  isAdmin: false,
  services: [],
  selectedSlot: null,
  settings: null
};

let db = null;
let toastTimer = null;

function toast(message) {
  const element = $("#toast");
  if (!element) return;

  element.textContent = message;
  element.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.classList.remove("show");
  }, 4000);
}

function errorMessage(error) {
  console.error(error);
  return error?.message || "Ocorreu um erro inesperado.";
}

function onlinePaymentsEnabled() {
  return state.settings?.infinitepay_enabled === true &&
    Boolean(String(state.settings?.infinitepay_handle || "").trim());
}

function updateOnlinePaymentOptions() {
  const select = $("#paymentMethod");
  if (!select) return;
  const enabled = onlinePaymentsEnabled();
  for (const option of select.options) {
    if (["pix_online", "card_online"].includes(option.value)) {
      option.disabled = !enabled;
      option.textContent = option.value === "pix_online"
        ? (enabled ? "Pix online" : "Pix online (indisponível)")
        : (enabled ? "Cartão online" : "Cartão online (indisponível)");
    }
  }
  if (!enabled && ["pix_online", "card_online"].includes(select.value)) {
    select.value = "pix_local";
  }
}

async function checkoutErrorMessage(error) {
  // Supabase FunctionsHttpError: o corpo real da resposta fica em context.
  try {
    if (error?.context && typeof error.context.json === "function") {
      const payload = await error.context.json();
      if (typeof payload?.error === "string") {
        if (/pagamento online indispon[ií]vel/i.test(payload.error))
          return "Pagamento online temporariamente indisponível. Escolha o pagamento presencial ou tente mais tarde.";
        if (/reserva n[aã]o eleg[ií]vel/i.test(payload.error))
          return "Esta reserva não está disponível para pagamento online.";
        return payload.error;
      }
    }
  } catch (parseError) { console.warn("Não foi possível ler o erro do checkout", parseError); }
  return "Não foi possível abrir o pagamento online. Tente novamente mais tarde.";
}

function requireDB() {
  if (!db) {
    throw new Error(
      "Supabase não configurado. Verifique o config.js."
    );
  }
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function minutesToTime(minutes) {
  return [
    String(Math.floor(minutes / 60)).padStart(2, "0"),
    String(minutes % 60).padStart(2, "0")
  ].join(":");
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function formatTime(value) {
  return String(value || "").slice(0, 5);
}

function formatDateTime(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Campo_Grande"
  }).format(new Date(value));
}

function setLoading(button, loading, text = "Aguarde...") {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    button.textContent =
      button.dataset.originalText || button.textContent;
  }
}

/* ======================================
   INICIALIZAÇÃO
====================================== */

async function initialize() {
  try {
    if (!window.supabase) {
      throw new Error("Biblioteca Supabase não carregada.");
    }

    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      throw new Error(
        "Configure SUPABASE_URL e SUPABASE_ANON_KEY no config.js."
      );
    }

    db = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );

    setupEvents();

    $("#bookingDate").min = localDate();
    $("#bookingDate").value = localDate();

    await loadSettings();
    await loadServices();

    const { data, error } = await db.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") {
      console.warn(error);
    }

    state.user = data?.user || null;

    await updateAuthentication();
    if (new URLSearchParams(location.search).has("order_nsu")) {
      toast("Retorno da InfinitePay recebido. O pagamento será confirmado após verificação no servidor.");
      history.replaceState({}, "", location.pathname + "#minhas");
    }

    db.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;

      setTimeout(() => {
        updateAuthentication().catch(console.error);
      }, 0);
    });

  } catch (error) {
    console.error(error);
    toast(errorMessage(error));

    const services = $("#services");
    if (services) {
      services.textContent =
        "Não foi possível conectar ao sistema.";
    }
  }
}

/* ======================================
   EVENTOS
====================================== */

function setupEvents() {
  $("#authBtn").addEventListener("click", async () => {
    if (state.user) {
      const { error } = await db.auth.signOut();

      if (error) {
        toast(errorMessage(error));
      }
    } else {
      openModal();
    }
  });

  $("#closeModal").addEventListener("click", closeModal);

  $("#authModal").addEventListener("click", (event) => {
    if (event.target.id === "authModal") {
      closeModal();
    }
  });

  $("#authForm").addEventListener("submit", login);

  $("#signupBtn").addEventListener("click", signup);

  $("#resetBtn").addEventListener("click", resetPassword);

  $("#serviceSelect").addEventListener("change", loadSlots);

  $("#bookingDate").addEventListener("change", loadSlots);

  $("#bookBtn").addEventListener("click", createBooking);

}

function openModal() {
  $("#authModal").hidden = false;
  $("#email").focus();
}

function closeModal() {
  $("#authModal").hidden = true;
}

/* ======================================
   AUTENTICAÇÃO
====================================== */

async function login(event) {
  event.preventDefault();

  try {
    requireDB();

    const email = $("#email").value.trim();
    const password = $("#password").value;

    const button = $("#loginBtn");
    setLoading(button, true, "Entrando...");

    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    setLoading(button, false);

    if (error) throw error;

    closeModal();
    toast("Login realizado com sucesso!");
    await updateAuthentication();
    window.location.assign(state.isAdmin ? "admin.html" : "cliente.html");

  } catch (error) {
    setLoading($("#loginBtn"), false);
    toast(errorMessage(error));
  }
}

async function signup() {
  try {
    requireDB();

    const email = $("#email").value.trim();
    const password = $("#password").value;

    if (!email || password.length < 6) {
      toast("Informe um e-mail e uma senha com 6 caracteres.");
      return;
    }

    const button = $("#signupBtn");
    setLoading(button, true, "Criando conta...");

    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin
      }
    });

    setLoading(button, false);

    if (error) throw error;

    if (data.session) {
      closeModal();
      toast("Conta criada com sucesso!");
      await updateAuthentication();
      window.location.assign(state.isAdmin ? "admin.html" : "cliente.html");
    } else {
      toast("Conta criada! Verifique seu e-mail para confirmar.");
    }

  } catch (error) {
    setLoading($("#signupBtn"), false);
    toast(errorMessage(error));
  }
}

async function resetPassword() {
  try {
    requireDB();

    const email = $("#email").value.trim();

    if (!email) {
      toast("Digite seu e-mail primeiro.");
      return;
    }

    const { error } = await db.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: window.location.origin
      }
    );

    if (error) throw error;

    toast("Se o e-mail estiver cadastrado, você receberá instruções.");

  } catch (error) {
    toast(errorMessage(error));
  }
}

async function updateAuthentication() {
  const authenticated = Boolean(state.user);

  $("#authBtn").textContent = authenticated ? "Sair" : "Entrar";

  state.isAdmin = false;

  if (authenticated) {
    const { data, error } = await db
      .from("profiles")
      .select("role")
      .eq("id", state.user.id)
      .maybeSingle();

    if (error) console.error(error);

    state.isAdmin = data?.role === "admin";
  }

  $("#adminLink").hidden = !state.isAdmin;
  const accountLink = $("#myAccountLink");
  if (accountLink) accountLink.hidden = !authenticated || state.isAdmin;
  const bookingsLink = $("#myBookingsLink");
  if (bookingsLink) bookingsLink.hidden = authenticated && !state.isAdmin;

  if (authenticated) {
    await loadMyBookings();
  } else {
    $("#myBookings").textContent =
      "Entre na sua conta para visualizar seus agendamentos.";
  }

}

/* ======================================
   CONFIGURAÇÕES DA BARBEARIA
====================================== */

async function loadSettings() {
  requireDB();

  const { data, error } = await db
    .from("barbershop_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  state.settings = data || {
    opening_time: "08:00",
    closing_time: "18:00",
    work_days: [1, 2, 3, 4, 5, 6]
  };

  updateOnlinePaymentOptions();

}

/* ======================================
   CATÁLOGO DE SERVIÇOS
====================================== */

async function loadServices() {
  requireDB();

  const { data, error } = await db
    .from("services")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) throw error;

  state.services = data || [];

  renderServices();
  renderServiceSelect();

  await loadSlots();
}

function renderServices() {
  const container = $("#services");

  if (!state.services.length) {
    container.innerHTML =
      "<p>Nenhum serviço cadastrado no momento.</p>";
    return;
  }

  container.innerHTML = state.services.map((service) => {
    const image = service.image_url
      ? `<img src="${escapeHTML(service.image_url)}"
              alt="${escapeHTML(service.name)}"
              loading="lazy">`
      : "";

    return `
      <article class="card">
        ${image}
        <div class="card-body">
          <h3>${escapeHTML(service.name)}</h3>
          <p>${escapeHTML(service.description || "")}</p>
          <p class="muted">
            Duração: ${Number(service.duration_minutes)} minutos
          </p>
          <div class="price">${money(service.price)}</div>
          <a class="primary"
             href="#agendar"
             data-service="${escapeHTML(service.id)}">
             Agendar
          </a>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-service]").forEach((link) => {
    link.addEventListener("click", () => {
      $("#serviceSelect").value = link.dataset.service;
      loadSlots();
    });
  });
}

function renderServiceSelect() {
  const select = $("#serviceSelect");
  const previous = select.value;

  select.innerHTML =
    '<option value="">Selecione um serviço</option>' +
    state.services.map((service) => `
      <option value="${escapeHTML(service.id)}">
        ${escapeHTML(service.name)} — ${money(service.price)}
      </option>
    `).join("");

  if (state.services.some((service) => service.id === previous)) {
    select.value = previous;
  }
}

/* ======================================
   HORÁRIOS DISPONÍVEIS
====================================== */

async function loadSlots() {
  const serviceId = $("#serviceSelect").value;
  const date = $("#bookingDate").value;

  state.selectedSlot = null;
  $("#bookingDetails").hidden = true;

  const container = $("#slots");

  if (!serviceId || !date) {
    container.textContent = "Selecione um serviço e uma data.";
    return;
  }

  container.textContent = "Consultando horários...";

  try {
    const { data, error } = await db.rpc(
      "get_available_slots",
      {
        p_service_id: serviceId,
        p_date: date
      }
    );

    if (error) throw error;

    const slots = data || [];

    if (!slots.length) {
      container.textContent =
        "Não existem horários disponíveis nesta data.";
      return;
    }

    container.innerHTML = "";

    slots.forEach((slot) => {
      const time = typeof slot === "string"
        ? slot
        : slot.slot_time || slot.start_time || slot.time;

      if (!time) return;

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = formatTime(time);

      button.addEventListener("click", () => {
        container.querySelectorAll("button").forEach((item) => {
          item.classList.remove("selected");
          item.setAttribute("aria-pressed", "false");
        });

        button.classList.add("selected");
        button.setAttribute("aria-pressed", "true");

        state.selectedSlot = formatTime(time);

        $("#chosenSlot").textContent =
          `${dateBR(date)} às ${state.selectedSlot}`;

        $("#bookingDetails").hidden = false;
      });

      container.appendChild(button);
    });

  } catch (error) {
    container.textContent = "Erro ao consultar horários.";
    toast(errorMessage(error));
  }
}

/* ======================================
   CRIAR AGENDAMENTO
====================================== */

async function createBooking() {
  if (!state.user) {
    toast("Entre na sua conta para agendar.");
    openModal();
    return;
  }

  const serviceId = $("#serviceSelect").value;
  const date = $("#bookingDate").value;
  const time = state.selectedSlot;
  const paymentMethod = $("#paymentMethod").value;
  const note = $("#bookingNote").value.trim();
  if (["pix_online", "card_online"].includes(paymentMethod) && !onlinePaymentsEnabled()) {
    toast("Pagamento online temporariamente indisponível. Escolha uma opção presencial.");
    updateOnlinePaymentOptions();
    return;
  }

  if (!serviceId || !date || !time) {
    toast("Selecione serviço, data e horário.");
    return;
  }

  const button = $("#bookBtn");

  try {
    setLoading(button, true, "Reservando...");

    const { data, error } = await db.rpc(
      "create_booking",
      {
        p_service_id: serviceId,
        p_date: date,
        p_time: time,
        p_payment_method: paymentMethod,
        p_note: note
      }
    );

    if (error) throw error;

    if (!data) {
      throw new Error("Não foi possível confirmar a reserva.");
    }

    if (["pix_online", "card_online"].includes(paymentMethod)) {
      // A reserva foi criada. O pagamento só será marcado como pago no servidor.
      try {
        const bookingId = typeof data === "string" ? data : data?.id || data?.booking_id;
        if (!bookingId) throw new Error("Reserva criada, mas o identificador não foi retornado. Abra Meus agendamentos para pagar.");
        const { data: checkout, error: checkoutError } = await db.functions.invoke("rodolfo-create-checkout", {body:{booking_id:bookingId}});
        if (checkoutError) throw checkoutError;
        if (!checkout?.url) throw new Error(checkout?.error || "Checkout indisponível.");
        window.location.assign(checkout.url);
        return;
      } catch (checkoutError) {
        console.error(checkoutError);
        toast(`Reserva criada. ${await checkoutErrorMessage(checkoutError)}`);
        await loadMyBookings();
        window.location.hash = "#minhas";
        return;
      }
    }

    toast("Agendamento realizado com sucesso!");

    $("#bookingNote").value = "";
    $("#bookingDetails").hidden = true;

    await Promise.all([
      loadSlots(),
      loadMyBookings()
    ]);


    window.location.hash = "#minhas";

  } catch (error) {
    toast(errorMessage(error));
    await loadSlots();
  } finally {
    setLoading(button, false);
  }
}

/* ======================================
   AGENDAMENTOS DO CLIENTE
====================================== */

async function loadMyBookings() {
  if (!state.user) return;

  const container = $("#myBookings");
  container.textContent = "Carregando agendamentos...";

  const { data, error } = await db
    .from("bookings")
    .select(`
      id,
      starts_at,
      ends_at,
      status,
      payment_method,
      payment_status,
      amount,
      infinitepay_checkout_url,
      services(name, price)
    `)
    .eq("user_id", state.user.id)
    .order("starts_at", { ascending: false })
    .limit(50);

  if (error) {
    container.textContent = errorMessage(error);
    return;
  }

  if (!data?.length) {
    container.textContent =
      "Você ainda não possui agendamentos.";
    return;
  }

  container.innerHTML = data.map((booking) => `
    <div class="booking-item">
      <h3>${escapeHTML(booking.services?.name || "Serviço")}</h3>
      <p>${formatDateTime(booking.starts_at)}</p>
      <p>Valor: ${money(booking.amount ?? booking.services?.price)}</p>
      <p>Status: ${escapeHTML(booking.status)}</p>
      <p>Pagamento: ${escapeHTML(booking.payment_status)}</p>
      ${["pix_online","card_online"].includes(booking.payment_method) && booking.payment_status === "pending" && !["cancelled"].includes(booking.status)
        ? (onlinePaymentsEnabled()
          ? `<button class="outline" data-checkout="${escapeHTML(booking.id)}">Pagar online</button>`
          : `<p class="muted">Pagamento online temporariamente indisponível. Entre em contato com a barbearia para combinar o pagamento.</p>`)
        : ""}
      ${
        ["pending", "confirmed"].includes(booking.status) && booking.payment_status === "pending" && !["pix_online","card_online"].includes(booking.payment_method)
          ? `<button class="outline"
               data-cancel="${escapeHTML(booking.id)}">
               Cancelar
             </button>`
          : ""
      }
      <hr>
    </div>
  `).join("");

  container.querySelectorAll("[data-checkout]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const {data: checkout, error} = await db.functions.invoke("rodolfo-create-checkout", {body:{booking_id:button.dataset.checkout}});
        if(error) throw error;
        if(!checkout?.url) throw new Error(checkout?.error || "Checkout indisponível");
        window.location.assign(checkout.url);
      } catch(e) { console.error(e); toast(await checkoutErrorMessage(e)); button.disabled=false; }
    });
  });
  container.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      cancelBooking(button.dataset.cancel);
    });
  });
}

async function cancelBooking(id) {
  if (!confirm("Deseja cancelar este agendamento?")) return;

  try {
    const { error } = await db.rpc(
      "cancel_my_booking",
      { p_booking_id: id }
    );

    if (error) throw error;

    toast("Agendamento cancelado.");

    await Promise.all([
      loadMyBookings(),
      loadSlots()
    ]);

  } catch (error) {
    toast(errorMessage(error));
  }
}

/* ======================================
   INICIAR SISTEMA
====================================== */

document.addEventListener("DOMContentLoaded", initialize);
