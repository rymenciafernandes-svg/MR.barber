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


    await loadSettings();
    await loadServices();

    const { data, error } = await db.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") {
      console.warn(error);
    }

    state.user = data?.user || null;

    await updateAuthentication();
    if (new URLSearchParams(location.search).has("order_nsu")) {
      toast("Retorno do pagamento recebido. Consulte o status na sua conta.");
      history.replaceState({}, "", location.pathname);
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
  for (const link of document.querySelectorAll('a[href="cliente.html"], a[href="cliente.html#agendar"]')) {
    link.addEventListener("click", (event) => {
      if (!state.user) {
        event.preventDefault();
        openModal();
      } else if (state.isAdmin) {
        event.preventDefault();
        window.location.assign("admin.html");
      }
    });
  }

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
        </div>
      </article>
    `;
  }).join("");
}

/* ======================================
   INICIAR SISTEMA
====================================== */

document.addEventListener("DOMContentLoaded", initialize);
