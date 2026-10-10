(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  // ---------------------------------------------------------------
  // Armazenamento local (fica só neste computador)
  // ---------------------------------------------------------------
  const store = {
    get(chave, padrao) {
      try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
    },
    set(chave, valor) {
      try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem espaço/bloqueado */ }
    },
  };
  const K = { prestador: "nfs.prestador", tomadores: "nfs.tomadores", historico: "nfs.historico", rascunho: "nfs.rascunho" };

  // ---------------------------------------------------------------
  // CPF / CNPJ (CNPJ alfanumérico conforme IN RFB 2.229/2024)
  // ---------------------------------------------------------------
  const soDoc = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

  function cpfValido(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    const dv = (len) => {
      let soma = 0;
      for (let i = 0; i < len; i++) soma += Number(cpf[i]) * (len + 1 - i);
      const r = (soma * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
  }

  function cnpjValido(cnpj) {
    // 12 primeiros: letras ou números; 2 últimos (DV): números
    if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
    const valor = (c) => c.charCodeAt(0) - 48; // '0'..'9' => 0..9, 'A'..'Z' => 17..42
    const dv = (len) => {
      const pesos = len === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
      let soma = 0;
      for (let i = 0; i < len; i++) soma += valor(cnpj[i]) * pesos[i];
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
  }

  function formatarDoc(s) {
    const d = soDoc(s);
    if (/^\d{11}$/.test(d)) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (d.length === 14) return d.replace(/(.{2})(.{3})(.{3})(.{4})(.{2})/, "$1.$2.$3/$4-$5");
    return s;
  }

  const formatarCNO = (s) => s.replace(/\D/g, "").replace(/^(\d{2})(\d{3})(\d{5})(\d{2})$/, "$1.$2.$3/$4");

  function docValido(s) {
    const d = soDoc(s);
    return d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) : false;
  }

  // ---------------------------------------------------------------
  // Valores e datas
  // ---------------------------------------------------------------
  function lerValor(s) {
    let t = String(s || "").replace(/[R$\s]/g, "");
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  const moeda = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
  const hojeISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  function gerarProtocolo() {
    const d = new Date();
    const p = (n, t = 2) => String(n).padStart(t, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // ---------------------------------------------------------------
  // Interface: abas, avisos
  // ---------------------------------------------------------------
  function irPara(tela) {
    $$(".aba").forEach((b) => b.classList.toggle("ativa", b.dataset.tela === tela));
    $$(".tela").forEach((s) => (s.hidden = s.id !== `tela-${tela}`));
    if (tela === "historico") desenharHistorico();
    if (tela === "dados") desenharTomadoresSalvos();
    window.scrollTo(0, 0);
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  function marcarErro(form, nome, msg) {
    const el = form.elements[nome];
    const alvo = el && el.length && !el.tagName ? el[0] : el;
    if (alvo && alvo.classList) alvo.classList.toggle("invalido", !!msg);
    const small = $(`[data-erro="${nome}"]`, form);
    if (small) small.textContent = msg || "";
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("Texto copiado.");
  }

  // ---------------------------------------------------------------
  // Meus dados (prestador)
  // ---------------------------------------------------------------
  const formDados = $("#form-dados");

  function carregarPrestador() {
    const p = store.get(K.prestador, null);
    // Permite o escritório mandar um link já preenchido: ?razao=...&cnpj=...&contato=...
    const qs = new URLSearchParams(location.search);
    const daUrl = {};
    for (const c of ["razao", "cnpj", "contato", "fone"]) if (qs.get(c)) daUrl[c] = qs.get(c);
    const dados = { ...(p || {}), ...daUrl };
    for (const [k, v] of Object.entries(dados)) if (formDados.elements[k]) formDados.elements[k].value = v;
    if (!p && daUrl.razao && daUrl.cnpj && daUrl.contato && cnpjValido(soDoc(daUrl.cnpj))) {
      store.set(K.prestador, { ...daUrl, cnpj: formatarDoc(daUrl.cnpj) });
    }
    atualizarAvisoCadastro();
  }

  function atualizarAvisoCadastro() {
    $("#aviso-cadastro").hidden = !!store.get(K.prestador, null);
  }

  formDados.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formDados.elements;
    let ok = true;
    const chk = (nome, cond, msg) => { marcarErro(formDados, nome, cond ? "" : msg); if (!cond) ok = false; };
    chk("razao", f.razao.value.trim(), "Informe a razão social.");
    chk("cnpj", cnpjValido(soDoc(f.cnpj.value)), "CNPJ inválido.");
    chk("contato", f.contato.value.trim(), "Informe seu nome.");
    if (!ok) return;
    f.cnpj.value = formatarDoc(f.cnpj.value);
    store.set(K.prestador, {
      razao: f.razao.value.trim(), cnpj: f.cnpj.value, contato: f.contato.value.trim(), fone: f.fone.value.trim(),
    });
    atualizarAvisoCadastro();
    toast("Dados salvos.");
    irPara("nova");
  });

  // ---------------------------------------------------------------
  // Tomadores frequentes
  // ---------------------------------------------------------------
  const CAMPOS_TOMADOR = ["tomadorDoc", "tomadorNome", "tomadorEmail", "tomadorFone",
    "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"];

  function preencherSelectFrequentes() {
    const lista = store.get(K.tomadores, []);
    const sel = $("#sel-frequente");
    sel.length = 1;
    lista.forEach((t, i) => sel.add(new Option(`${t.tomadorNome} — ${t.tomadorDoc}`, i)));
    $("#linha-frequentes").hidden = lista.length === 0;
  }

  function salvarTomador(dados) {
    const t = Object.fromEntries(CAMPOS_TOMADOR.map((c) => [c, dados[c] || ""]));
    const lista = store.get(K.tomadores, []).filter((x) => soDoc(x.tomadorDoc) !== soDoc(t.tomadorDoc));
    lista.unshift(t);
    store.set(K.tomadores, lista.slice(0, 100));
  }

  function desenharTomadoresSalvos() {
    const lista = store.get(K.tomadores, []);
    const box = $("#lista-tomadores");
    box.innerHTML = "";
    if (!lista.length) { box.innerHTML = '<p class="dica">Nenhum cliente guardado ainda.</p>'; return; }
    lista.forEach((t, i) => {
      const div = document.createElement("div");
      div.className = "tomador-salvo";
      const span = document.createElement("span");
      span.textContent = `${t.tomadorNome} — ${t.tomadorDoc}`;
      const btn = document.createElement("button");
      btn.className = "btn btn-secundario btn-pequeno";
      btn.textContent = "Remover";
      btn.onclick = () => {
        const l = store.get(K.tomadores, []);
        l.splice(i, 1);
        store.set(K.tomadores, l);
        desenharTomadoresSalvos();
        preencherSelectFrequentes();
      };
      div.append(span, btn);
      box.appendChild(div);
    });
  }

  // ---------------------------------------------------------------
  // Formulário da solicitação
  // ---------------------------------------------------------------
  const form = $("#form-nfs");

  $("#sel-frequente").addEventListener("change", (e) => {
    const t = store.get(K.tomadores, [])[e.target.value];
    if (!t) return;
    CAMPOS_TOMADOR.forEach((c) => (form.elements[c].value = t[c] || ""));
    if (t.cep || t.logradouro) $("details.endereco").open = true;
    CAMPOS_TOMADOR.forEach((c) => marcarErro(form, c, ""));
  });

  $("#tomadorDoc").addEventListener("blur", (e) => {
    const v = e.target.value.trim();
    if (!v) return;
    e.target.value = formatarDoc(v);
    marcarErro(form, "tomadorDoc", docValido(v) ? "" : "CPF/CNPJ inválido. Confira os números.");
  });

  $("#valor").addEventListener("blur", (e) => {
    const n = lerValor(e.target.value);
    if (e.target.value && Number.isFinite(n)) e.target.value = n.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  });

  // Busca de endereço pelo CEP (ViaCEP)
  $("#cep").addEventListener("blur", async (e) => {
    const cep = e.target.value.replace(/\D/g, "");
    const status = $("#cep-status");
    status.textContent = "";
    if (cep.length !== 8) return;
    e.target.value = cep.replace(/(\d{5})(\d{3})/, "$1-$2");
    status.textContent = "Buscando…";
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (j.erro) { status.textContent = "CEP não encontrado."; return; }
      const f = form.elements;
      f.logradouro.value = j.logradouro || f.logradouro.value;
      f.bairro.value = j.bairro || f.bairro.value;
      f.cidade.value = j.localidade || f.cidade.value;
      f.uf.value = j.uf || f.uf.value;
      status.textContent = "";
      f.numero.focus();
    } catch {
      status.textContent = "Sem conexão para buscar o CEP — preencha à mão.";
    }
  });

  $$('input[name="obra"]').forEach((r) =>
    r.addEventListener("change", () => {
      $("#linha-obra").hidden = form.elements.obra.value !== "Sim";
    })
  );

  $$('input[name="retencao"]').forEach((r) =>
    r.addEventListener("change", () => {
      $("#quais-retencoes").hidden = form.elements.retencao.value !== "Sim";
    })
  );

  // Rascunho: não perde o que foi digitado se fechar sem querer
  form.addEventListener("input", () => store.set(K.rascunho, lerForm()));

  function lerForm() {
    const f = form.elements;
    const d = {};
    for (const el of f) {
      if (!el.name || el.type === "radio" || el.type === "checkbox") continue;
      d[el.name] = el.value.trim();
    }
    d.retencao = f.retencao.value;
    d.obra = f.obra.value;
    d.retidos = $$('input[name="retidos"]:checked', form).map((c) => c.value);
    d.salvarTomador = f.salvarTomador.checked;
    d.urgente = f.urgente.checked;
    return d;
  }

  function preencherForm(d) {
    const f = form.elements;
    for (const [k, v] of Object.entries(d)) {
      const el = f[k];
      if (!el) continue;
      if (k === "retencao" || k === "obra") { $$(`input[name="${k}"]`, form).forEach((r) => (r.checked = r.value === v)); continue; }
      if (k === "retidos") { $$('input[name="retidos"]', form).forEach((c) => (c.checked = v.includes(c.value))); continue; }
      if (el.type === "checkbox") el.checked = !!v; else el.value = v;
    }
    $("#quais-retencoes").hidden = f.retencao.value !== "Sim";
    $("#linha-obra").hidden = f.obra.value !== "Sim";
  }

  function limparForm() {
    form.reset();
    $$(".invalido", form).forEach((el) => el.classList.remove("invalido"));
    $$(".erro", form).forEach((el) => (el.textContent = ""));
    form.elements.competencia.value = hojeISO();
    $("#quais-retencoes").hidden = true;
    $("#linha-obra").hidden = true;
    $("details.endereco").open = false;
    store.set(K.rascunho, null);
  }

  $("#btn-limpar").addEventListener("click", () => {
    if (confirm("Apagar tudo o que foi preenchido?")) limparForm();
  });

  function validar(d) {
    let primeiro = null;
    const chk = (nome, cond, msg) => {
      marcarErro(form, nome, cond ? "" : msg);
      if (!cond && !primeiro) primeiro = nome;
    };
    chk("tomadorDoc", docValido(d.tomadorDoc), d.tomadorDoc ? "CPF/CNPJ inválido. Confira os números." : "Informe o CPF ou CNPJ.");
    chk("tomadorNome", d.tomadorNome, "Informe o nome ou razão social.");
    chk("tomadorEmail", !d.tomadorEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.tomadorEmail), "E-mail inválido.");
    chk("descricao", d.descricao.length >= 5, "Descreva o serviço.");
    const v = lerValor(d.valor);
    chk("valor", Number.isFinite(v) && v > 0, "Informe um valor maior que zero.");
    chk("competencia", d.competencia, "Informe a data do serviço.");
    chk("localPrestacao", d.localPrestacao, "Informe a cidade onde o serviço foi feito.");
    chk("codigoObra", d.obra !== "Sim" || /^\d{12}$/.test(d.codigoObra.replace(/\D/g, "")),
      d.codigoObra ? "O CNO tem 12 números. Confira." : "Informe o código da obra (CNO).");
    if (primeiro) {
      const el = form.elements[primeiro];
      if (primeiro === "cep") $("details.endereco").open = true;
      el.focus();
      el.scrollIntoView({ block: "center" });
    }
    return !primeiro;
  }

  // ---------------------------------------------------------------
  // Montagem do pedido
  // ---------------------------------------------------------------
  const SEP = Symbol("linha em branco");

  function montarTexto(p) {
    const { prestador: pr, dados: d } = p;
    const end = [d.logradouro, d.numero, d.complemento, d.bairro, d.cidade && `${d.cidade}${d.uf ? "/" + d.uf : ""}`, d.cep]
      .filter(Boolean).join(", ");
    const ret = d.retencao === "Sim" ? `Sim — ${d.retidos.length ? d.retidos.join(", ") : "não especificado"}` : d.retencao;
    const linhas = [
      `${d.urgente ? "URGENTE — " : ""}SOLICITAÇÃO DE NFS-e — Protocolo ${p.protocolo}`,
      SEP,
      `EMITENTE (prestador)`,
      `${pr.razao} — CNPJ ${pr.cnpj}`,
      `Solicitado por: ${pr.contato}${pr.fone ? " — " + pr.fone : ""}`,
      SEP,
      `TOMADOR`,
      `${d.tomadorNome}`,
      `CPF/CNPJ: ${formatarDoc(d.tomadorDoc)}`,
      d.tomadorEmail && `E-mail: ${d.tomadorEmail}`,
      d.tomadorFone && `Telefone: ${d.tomadorFone}`,
      end && `Endereço: ${end}`,
      SEP,
      `SERVIÇO`,
      `Descrição: ${d.descricao}`,
      `Valor: ${moeda(lerValor(d.valor))}`,
      `Competência: ${dataBR(d.competencia)}`,
      `Local da prestação: ${d.localPrestacao}`,
      d.obra === "Sim" && `Obra de construção civil — CNO: ${formatarCNO(d.codigoObra)}`,
      SEP,
      `Retenção de impostos: ${ret}`,
      d.vencimento && `Vencimento: ${dataBR(d.vencimento)}`,
      d.infoNota && `Informações extras na nota: ${d.infoNota}`,
      d.observacoes && SEP,
      d.observacoes && `OBSERVAÇÕES: ${d.observacoes}`,
    ];
    // Campos vazios ficam de fora; SEP marca as linhas em branco entre blocos
    return linhas.filter(Boolean).map((l) => (l === SEP ? "" : l))
      .join("\n").trim();
  }

  function assunto(p) {
    return `${p.dados.urgente ? "[URGENTE] " : ""}Pedido NFS-e ${p.protocolo} — ${p.prestador.razao} → ${p.dados.tomadorNome} — ${moeda(lerValor(p.dados.valor))}`;
  }

  let pedidoAtual = null;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const prestador = store.get(K.prestador, null);
    if (!prestador) {
      toast("Preencha primeiro os dados da sua empresa.");
      irPara("dados");
      return;
    }
    const dados = lerForm();
    if (!validar(dados)) return;
    pedidoAtual = { protocolo: gerarProtocolo(), criadoEm: new Date().toISOString(), prestador, dados, enviado: false };
    pedidoAtual.texto = montarTexto(pedidoAtual);
    $("#txt-revisao").textContent = pedidoAtual.texto;
    $("#btn-enviar").disabled = false;
    $("#btn-enviar").textContent = "Enviar pedido ao escritório";
    $("#dlg-revisao").showModal();
  });

  // ---------------------------------------------------------------
  // Envio
  // ---------------------------------------------------------------
  async function enviarPorEmail(p) {
    const modo = CFG.envio || "formsubmit";
    const corpo = {
      protocolo: p.protocolo,
      assunto: assunto(p),
      texto: p.texto,
      prestador: p.prestador,
      dados: p.dados,
    };

    if (modo === "formsubmit") {
      const r = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(CFG.email)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          _subject: corpo.assunto,
          _template: "box",
          _captcha: "false",
          Pedido: p.texto,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || String(j.success) !== "true") throw new Error(j.message || `Falha no envio (${r.status})`);
      return;
    }

    const r = await fetch(modo, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.erro || `Falha no envio (${r.status})`);
  }

  function registrarNoHistorico(p) {
    const h = store.get(K.historico, []).filter((x) => x.protocolo !== p.protocolo);
    h.unshift(p);
    store.set(K.historico, h.slice(0, 300));
  }

  async function concluirEnvio() {
    const p = pedidoAtual;
    const btn = $("#btn-enviar");
    btn.disabled = true;
    btn.textContent = "Enviando…";
    try {
      await enviarPorEmail(p);
      p.enviado = true;
    } catch (err) {
      p.erro = String(err.message || err);
    }
    registrarNoHistorico(p);
    if (p.dados.salvarTomador) salvarTomador(p.dados);
    preencherSelectFrequentes();

    if (!p.enviado) {
      btn.disabled = false;
      btn.textContent = "Tentar enviar de novo";
      alert(
        "Não foi possível enviar agora.\n\n" +
        "O pedido ficou salvo no Histórico. Você pode tentar de novo, ou usar “Copiar texto” " +
        `e mandar para ${CFG.email}.\n\nDetalhe: ${p.erro}`
      );
      return;
    }
    $("#dlg-revisao").close();
    limparForm();
    $("#ok-protocolo").textContent = p.protocolo;
    $("#ok-prazo").textContent = CFG.prazoAtendimento || "";
    $("#dlg-ok").showModal();
  }

  $("#btn-enviar").addEventListener("click", concluirEnvio);
  $("#btn-copiar").addEventListener("click", () => copiar(pedidoAtual.texto));
  $("#btn-voltar").addEventListener("click", () => $("#dlg-revisao").close());
  $("#btn-ok").addEventListener("click", () => $("#dlg-ok").close());

  // ---------------------------------------------------------------
  // Histórico
  // ---------------------------------------------------------------
  function desenharHistorico() {
    const h = store.get(K.historico, []);
    const box = $("#lista-historico");
    box.innerHTML = "";
    if (!h.length) { box.innerHTML = '<p class="dica">Nenhum pedido ainda.</p>'; return; }

    h.forEach((p) => {
      const item = document.createElement("div");
      item.className = "item-hist";
      const cab = document.createElement("div");
      cab.className = "cab";
      const esq = document.createElement("div");
      const nome = document.createElement("strong");
      nome.textContent = p.dados.tomadorNome;
      esq.appendChild(nome);
      if (!p.enviado) {
        const s = document.createElement("span");
        s.className = "selo";
        s.textContent = "não enviado";
        esq.appendChild(s);
      }
      const det = document.createElement("div");
      det.className = "dica";
      det.textContent = `Protocolo ${p.protocolo} · ${new Date(p.criadoEm).toLocaleString("pt-BR")}`;
      esq.appendChild(det);
      const val = document.createElement("div");
      val.className = "valor";
      val.textContent = moeda(lerValor(p.dados.valor));
      cab.append(esq, val);

      const acoes = document.createElement("div");
      acoes.className = "acoes";
      const mk = (txt, fn) => {
        const b = document.createElement("button");
        b.className = "btn btn-secundario btn-pequeno";
        b.textContent = txt;
        b.onclick = fn;
        acoes.appendChild(b);
      };
      if (!p.enviado) {
        mk("Enviar agora", async () => {
          try { await enviarPorEmail(p); p.enviado = true; delete p.erro; registrarNoHistorico(p); toast("Pedido enviado."); }
          catch (err) { toast("Ainda não foi possível enviar."); }
          desenharHistorico();
        });
      }
      mk("Copiar texto", () => copiar(p.texto));
      mk("Pedir outra igual", () => {
        const d = { ...p.dados, competencia: hojeISO(), vencimento: "" };
        irPara("nova");
        limparForm();
        preencherForm(d);
        toast("Dados copiados. Ajuste o que mudou e envie.");
      });

      item.append(cab, acoes);
      box.appendChild(item);
    });
  }

  // ---------------------------------------------------------------
  // Instalação como app (ícone na área de trabalho)
  // ---------------------------------------------------------------
  let eventoInstalar = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    eventoInstalar = e;
    $("#btn-instalar").hidden = false;
  });
  $("#btn-instalar").addEventListener("click", async () => {
    if (!eventoInstalar) return;
    eventoInstalar.prompt();
    await eventoInstalar.userChoice;
    eventoInstalar = null;
    $("#btn-instalar").hidden = true;
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // ---------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------
  $("#nome-escritorio").textContent = CFG.nomeEscritorio || "";
  $$(".aba").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.tela)));
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-ir]");
    if (a) { e.preventDefault(); irPara(a.dataset.ir); }
  });

  carregarPrestador();
  preencherSelectFrequentes();
  form.elements.competencia.value = hojeISO();
  const rascunho = store.get(K.rascunho, null);
  if (rascunho) preencherForm(rascunho);
  if (!store.get(K.prestador, null)) irPara("dados");

  // Exposto só para testes automatizados
  window.__nfs = { cpfValido, cnpjValido, lerValor, montarTexto };
})();
