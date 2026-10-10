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
  const K = { prestador: "nfs.prestador", tomadores: "nfs.tomadores", rascunho: "nfs.rascunho", pedidos: "nfs.pedidos" };

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
    // Sufixo aleatório evita colisão entre dois clientes no mesmo segundo
    const sufixo = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${sufixo}`;
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
  // Comunicação com o escritório (Google Apps Script)
  // ---------------------------------------------------------------
  // O corpo vai como texto puro para o navegador não exigir "preflight" de CORS,
  // que o Apps Script não responde.
  async function api(acao, dados = {}) {
    if (!CFG.apiUrl) throw new Error("App sem endereço do servidor (apiUrl em config.js).");
    const r = await fetch(CFG.apiUrl, { method: "POST", body: JSON.stringify({ acao, ...dados }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.erro || `Falha de comunicação (${r.status})`);
    return j;
  }

  // ---------------------------------------------------------------
  // Meus dados: contato e empresas (vários CNPJs)
  // ---------------------------------------------------------------
  const formDados = $("#form-dados");
  const prestador = () => store.get(K.prestador, null);

  function linhaEmpresa(emp = {}) {
    const el = $("#tpl-empresa").content.firstElementChild.cloneNode(true);
    $('[data-campo="razao"]', el).value = emp.razao || "";
    $('[data-campo="cnpj"]', el).value = emp.cnpj || "";
    $('[data-campo="cnpj"]', el).addEventListener("blur", (e) => {
      if (e.target.value.trim()) e.target.value = formatarDoc(e.target.value);
    });
    $(".btn-remover", el).onclick = () => {
      el.remove();
      if (!$("#lista-empresas").children.length) $("#lista-empresas").appendChild(linhaEmpresa());
    };
    return el;
  }

  function carregarPrestador() {
    const p = prestador() || {};
    const f = formDados.elements;
    f.contato.value = p.contato || "";
    f.fone.value = p.fone || "";
    const box = $("#lista-empresas");
    box.innerHTML = "";
    (p.empresas && p.empresas.length ? p.empresas : [{}]).forEach((emp) => box.appendChild(linhaEmpresa(emp)));
    atualizarAvisoCadastro();
    preencherEmitentes();
  }

  function atualizarAvisoCadastro() {
    $("#aviso-cadastro").hidden = !!prestador();
  }

  $("#btn-add-empresa").addEventListener("click", () => {
    const el = linhaEmpresa();
    $("#lista-empresas").appendChild(el);
    $("input", el).focus();
  });

  formDados.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formDados.elements;
    let ok = true;
    const chk = (nome, cond, msg) => { marcarErro(formDados, nome, cond ? "" : msg); if (!cond) ok = false; };

    chk("contato", f.contato.value.trim(), "Informe seu nome.");

    const empresas = [];
    let empresasOk = true;
    $$("#lista-empresas .empresa").forEach((el) => {
      const razao = $('[data-campo="razao"]', el);
      const cnpj = $('[data-campo="cnpj"]', el);
      const vazia = !razao.value.trim() && !cnpj.value.trim();
      const cnpjOk = cnpjValido(soDoc(cnpj.value));
      razao.classList.toggle("invalido", !vazia && !razao.value.trim());
      cnpj.classList.toggle("invalido", !vazia && !cnpjOk);
      if (vazia) return;
      if (!razao.value.trim() || !cnpjOk) { empresasOk = false; return; }
      empresas.push({ razao: razao.value.trim(), cnpj: formatarDoc(cnpj.value) });
    });
    const repetido = new Set(empresas.map((x) => soDoc(x.cnpj))).size !== empresas.length;
    chk("empresas", empresasOk && empresas.length && !repetido,
      repetido ? "CNPJ repetido." : empresas.length || !empresasOk ? "Confira razão social e CNPJ marcados em vermelho." : "Cadastre ao menos uma empresa.");
    if (!ok) return;

    store.set(K.prestador, { contato: f.contato.value.trim(), fone: f.fone.value.trim(), empresas });
    carregarPrestador();
    toast("Dados salvos.");
    irPara("nova");
  });

  function preencherEmitentes() {
    const sel = $("#sel-emitente");
    const atual = sel.value;
    sel.length = 0;
    const empresas = prestador()?.empresas || [];
    if (empresas.length > 1) sel.add(new Option("— escolha a empresa —", ""));
    empresas.forEach((emp) => sel.add(new Option(`${emp.razao} — ${emp.cnpj}`, emp.cnpj)));
    if ([...sel.options].some((o) => o.value === atual)) sel.value = atual;
  }

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
  // Anexos
  // ---------------------------------------------------------------
  const MAX_ANEXOS = 5;
  const MAX_BYTES = 10 * 1024 * 1024;
  let anexos = [];

  const tamanho = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

  function desenharAnexos() {
    const ul = $("#lista-anexos");
    ul.innerHTML = "";
    anexos.forEach((f, i) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = `${f.name} (${tamanho(f.size)})`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-link btn-pequeno";
      btn.textContent = "Remover";
      btn.onclick = () => { anexos.splice(i, 1); desenharAnexos(); };
      li.append(span, btn);
      ul.appendChild(li);
    });
  }

  $("#inp-anexos").addEventListener("change", (e) => {
    for (const f of e.target.files) {
      if (anexos.length >= MAX_ANEXOS) { toast(`Máximo de ${MAX_ANEXOS} arquivos.`); break; }
      if (anexos.some((a) => a.name === f.name && a.size === f.size)) continue;
      if (anexos.reduce((s, a) => s + a.size, 0) + f.size > MAX_BYTES) { toast("Os anexos passam de 10 MB no total."); continue; }
      anexos.push(f);
    }
    e.target.value = "";
    desenharAnexos();
  });

  const lerBase64 = (file) => new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => falha(r.error);
    r.readAsDataURL(file);
  });

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

  // Rascunho: não perde o que foi digitado se fechar sem querer (anexos não entram)
  form.addEventListener("input", () => store.set(K.rascunho, lerForm()));

  function lerForm() {
    const f = form.elements;
    const d = {};
    for (const el of f) {
      if (!el.name || el.type === "radio" || el.type === "checkbox" || el.type === "file") continue;
      d[el.name] = el.value.trim();
    }
    d.retencao = f.retencao.value;
    d.retidos = $$('input[name="retidos"]:checked', form).map((c) => c.value);
    d.obra = f.obra.value;
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
      if (k === "retidos") { $$('input[name="retidos"]', form).forEach((c) => (c.checked = (v || []).includes(c.value))); continue; }
      if (el.type === "checkbox") el.checked = !!v; else el.value = v;
    }
    $("#quais-retencoes").hidden = f.retencao.value !== "Sim";
    $("#linha-obra").hidden = f.obra.value !== "Sim";
  }

  function limparForm() {
    const emitente = $("#sel-emitente").value;
    form.reset();
    $("#sel-emitente").value = emitente;
    $$(".invalido", form).forEach((el) => el.classList.remove("invalido"));
    $$(".erro", form).forEach((el) => (el.textContent = ""));
    form.elements.competencia.value = hojeISO();
    $("#quais-retencoes").hidden = true;
    $("#linha-obra").hidden = true;
    $("details.endereco").open = false;
    anexos = [];
    desenharAnexos();
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
    chk("emitente", d.emitente, "Escolha a empresa que emite a nota.");
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
      `${d.emitenteRazao} — CNPJ ${d.emitenteCnpj}`,
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
      p.nomesAnexos.length && SEP,
      p.nomesAnexos.length && `ANEXOS: ${p.nomesAnexos.join("; ")}`,
      d.observacoes && SEP,
      d.observacoes && `OBSERVAÇÕES: ${d.observacoes}`,
    ];
    // Campos vazios ficam de fora; SEP marca as linhas em branco entre blocos
    return linhas.filter(Boolean).map((l) => (l === SEP ? "" : l))
      .join("\n").trim();
  }

  function assunto(p) {
    return `${p.dados.urgente ? "[URGENTE] " : ""}Pedido NFS-e ${p.protocolo} — ${p.dados.emitenteRazao} → ${p.dados.tomadorNome} — ${moeda(lerValor(p.dados.valor))}`;
  }

  let pedidoAtual = null;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const pr = prestador();
    if (!pr) {
      toast("Preencha primeiro Meus dados.");
      irPara("dados");
      return;
    }
    const dados = lerForm();
    if (!validar(dados)) return;
    const emp = pr.empresas.find((x) => x.cnpj === dados.emitente);
    dados.emitenteRazao = emp.razao;
    dados.emitenteCnpj = emp.cnpj;
    dados.valorNumero = lerValor(dados.valor);
    pedidoAtual = { protocolo: gerarProtocolo(), prestador: pr, dados, arquivos: [...anexos], nomesAnexos: anexos.map((a) => a.name) };
    pedidoAtual.texto = montarTexto(pedidoAtual);
    $("#txt-revisao").textContent = pedidoAtual.texto;
    $("#btn-enviar").disabled = false;
    $("#btn-enviar").textContent = "Enviar pedido ao escritório";
    $("#dlg-revisao").showModal();
  });

  // ---------------------------------------------------------------
  // Envio
  // ---------------------------------------------------------------
  async function concluirEnvio() {
    const p = pedidoAtual;
    const btn = $("#btn-enviar");
    btn.disabled = true;
    btn.textContent = p.arquivos.length ? "Enviando anexos…" : "Enviando…";
    try {
      const anexosB64 = await Promise.all(p.arquivos.map(async (f) => ({
        nome: f.name, tipo: f.type || "application/octet-stream", base64: await lerBase64(f),
      })));
      await api("enviar", {
        protocolo: p.protocolo, assunto: assunto(p), texto: p.texto, dados: p.dados, anexos: anexosB64,
        contato: p.prestador.contato, fone: p.prestador.fone,
      });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Tentar enviar de novo";
      alert(
        "Não foi possível enviar agora.\n\n" +
        "Confira a internet e clique em “Tentar enviar de novo”. Se continuar, use “Copiar texto” " +
        `e mande para ${CFG.email}.\n\nDetalhe: ${err.message}`
      );
      return;
    }
    if (p.dados.salvarTomador) salvarTomador(p.dados);
    guardarPedidoLocal(p);
    preencherSelectFrequentes();
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
  // Minhas notas (lista vinda do escritório)
  // ---------------------------------------------------------------
  // O servidor não devolve os dados completos do tomador; para "Pedir outra igual"
  // usamos a cópia guardada neste computador no momento do envio.
  function guardarPedidoLocal(p) {
    const mapa = store.get(K.pedidos, {});
    mapa[p.protocolo] = p.dados;
    const chaves = Object.keys(mapa);
    chaves.slice(0, Math.max(0, chaves.length - 200)).forEach((k) => delete mapa[k]);
    store.set(K.pedidos, mapa);
  }

  const classeStatus = (s) =>
    /emitida/i.test(s) ? "emitida" : /pendente/i.test(s) ? "pendente" : /cancel/i.test(s) ? "cancelado" : "";

  async function abrirNota(pedido, arquivo, baixar) {
    toast("Abrindo nota…");
    try {
      const j = await api("baixar", { protocolo: pedido.protocolo, cnpj: pedido.cnpjEmitente, arquivoId: arquivo.id });
      const bytes = Uint8Array.from(atob(j.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: j.tipo || "application/pdf" }));
      if (baixar) {
        const a = document.createElement("a");
        a.href = url;
        a.download = j.nome || arquivo.nome;
        a.click();
      } else {
        window.open(url, "_blank");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast(`Não foi possível abrir: ${err.message}`);
    }
  }

  async function desenharHistorico() {
    const box = $("#lista-historico");
    if (!prestador()) { box.innerHTML = '<p class="dica">Preencha Meus dados para ver suas notas.</p>'; return; }
    box.innerHTML = '<p class="dica">Carregando…</p>';
    let pedidos;
    try {
      pedidos = (await api("listar", { cnpjs: prestador().empresas.map((e) => e.cnpj) })).pedidos;
    } catch (err) {
      box.innerHTML = "";
      const p = document.createElement("p");
      p.className = "dica";
      p.textContent = `Não foi possível carregar agora (${err.message}). Confira a internet e clique em Atualizar.`;
      box.appendChild(p);
      return;
    }
    box.innerHTML = "";
    if (!pedidos.length) { box.innerHTML = '<p class="dica">Nenhum pedido ainda.</p>'; return; }

    const el = (tag, cls, txt) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (txt !== undefined) n.textContent = txt;
      return n;
    };

    pedidos.forEach((p) => {
      const item = el("div", "item-hist");
      const cab = el("div", "cab");
      const esq = el("div");
      esq.append(el("strong", "", p.tomador), el("span", `status ${classeStatus(p.status)}`, p.status));
      esq.appendChild(el("div", "dica",
        `Protocolo ${p.protocolo} · ${new Date(p.data).toLocaleDateString("pt-BR")}${p.emitente ? " · " + p.emitente : ""}`));
      const valor = typeof p.valor === "number" ? moeda(p.valor) : String(p.valor || "");
      cab.append(esq, el("div", "valor", valor));
      item.appendChild(cab);

      if (p.mensagem) item.appendChild(el("div", "mensagem", `Escritório: ${p.mensagem}`));

      if (p.notas && p.notas.length) {
        const notas = el("div", "notas");
        p.notas.forEach((n) => {
          const linha = el("div", "nota");
          const ver = el("button", "btn btn-primario btn-pequeno", "Ver PDF");
          ver.onclick = () => abrirNota(p, n, false);
          const baixar = el("button", "btn btn-secundario btn-pequeno", "Baixar");
          baixar.onclick = () => abrirNota(p, n, true);
          linha.append(el("span", "nome", n.nome), ver, baixar);
          notas.appendChild(linha);
        });
        item.appendChild(notas);
      }

      const dadosLocais = store.get(K.pedidos, {})[p.protocolo];
      if (dadosLocais) {
        const acoes = el("div", "acoes");
        const repetir = el("button", "btn btn-secundario btn-pequeno", "Pedir outra igual");
        repetir.onclick = () => {
          const d = { ...dadosLocais, competencia: hojeISO(), vencimento: "" };
          irPara("nova");
          limparForm();
          preencherForm(d);
          if (!prestador().empresas.some((x) => x.cnpj === d.emitente)) $("#sel-emitente").selectedIndex = 0;
          toast("Dados copiados. Ajuste o que mudou e envie.");
        };
        acoes.appendChild(repetir);
        item.appendChild(acoes);
      }
      box.appendChild(item);
    });
  }

  $("#btn-atualizar").addEventListener("click", desenharHistorico);

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
  if (!prestador()) irPara("dados");

  // Exposto só para testes automatizados
  window.__nfs = { cpfValido, cnpjValido, lerValor, montarTexto };
})();
