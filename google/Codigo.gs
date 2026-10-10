/**
 * Servidor do app "Solicitar NFS-e" — roda no Google Apps Script, ligado à planilha do escritório.
 *
 * O que faz:
 *  - recebe os pedidos do app, grava na aba "Pedidos", cria uma pasta no Drive para cada pedido
 *    (com os anexos do cliente) e manda um e-mail para o escritório;
 *  - devolve ao app a lista de pedidos dos CNPJs cadastrados nele, com status e os PDFs que o
 *    escritório colocou na subpasta "NFS-e emitida" de cada pedido.
 *
 * Atenção: não há senha nem código de acesso. Quem informar um CNPJ vê os pedidos e as notas
 * daquele CNPJ (decisão do escritório). Por isso a lista devolve só o mínimo: tomador, valor,
 * status, recado e PDFs — endereço, e-mail e telefone dos tomadores ficam só na planilha.
 *
 * Instalação: veja google/COMO-INSTALAR.md
 */

// ===================== CONFIGURAÇÃO =====================
const EMAIL_ESCRITORIO = 'fiscal@nomadcontabilidade.com.br';
const NOME_PASTA_RAIZ = 'Pedidos NFS-e (app)';
const MAX_ANEXOS = 5;
const MAX_BYTES_ANEXOS = 10 * 1024 * 1024; // 10 MB somando todos
const MAX_PEDIDOS_LISTADOS = 60;
const MAX_CNPJS_POR_CONSULTA = 20;
// ========================================================

const ABA_PEDIDOS = 'Pedidos';
const PASTA_ANEXOS = 'Anexos do cliente';
const PASTA_NFS = 'NFS-e emitida';
const STATUS = ['Recebido', 'Em emissão', 'Pendente (ver mensagem)', 'Emitida', 'Cancelado'];

const COL_PEDIDOS = ['Data', 'Protocolo', 'Emitente', 'CNPJ emitente', 'Solicitante', 'Tomador',
  'CPF/CNPJ tomador', 'Valor', 'Urgente', 'Status', 'Mensagem ao cliente', 'Pasta no Drive', 'ID pasta NFS', 'Dados'];
const C = Object.fromEntries(COL_PEDIDOS.map((n, i) => [n, i]));

// ---------------------------------------------------------------------------
// Menu da planilha
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('NFS-e')
    .addItem('Configurar (só na primeira vez)', 'configurar')
    .addToUi();
}

// Pode rodar pelo menu, pelo botão "Executar" do editor ou sozinho no primeiro pedido.
function configurar() {
  prepararPlanilha_();
  try {
    SpreadsheetApp.getUi().alert('Pronto. Aba "Pedidos" e pasta "' + NOME_PASTA_RAIZ + '" criadas no seu Google Drive.\n\n' +
      'Agora publique o script: Implantar > Nova implantação > App da Web.');
  } catch (err) {
    console.log('Configurado. Aba "Pedidos" e pasta "' + NOME_PASTA_RAIZ + '" criadas.'); // rodou pelo editor
  }
}

function prepararPlanilha_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  let ped = ss.getSheetByName(ABA_PEDIDOS) || ss.insertSheet(ABA_PEDIDOS);
  if (ped.getLastRow() === 0) {
    ped.appendRow(COL_PEDIDOS);
    ped.getRange(1, 1, 1, COL_PEDIDOS.length).setFontWeight('bold');
    ped.setFrozenRows(1);
    ped.getRange('B:B').setNumberFormat('@'); // protocolo sempre como texto
    ped.getRange(1, C['Valor'] + 1, ped.getMaxRows(), 1).setNumberFormat('"R$" #,##0.00');
    ped.getRange(2, C['Status'] + 1, ped.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUS).build());
    ped.hideColumns(C['ID pasta NFS'] + 1, 2); // colunas técnicas
  }

  if (!props.getProperty('PASTA_RAIZ')) {
    props.setProperty('PASTA_RAIZ', DriveApp.createFolder(NOME_PASTA_RAIZ).getId());
  }
  props.setProperty('PLANILHA', ss.getId());
}

// ---------------------------------------------------------------------------
// API usada pelo app
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!PropertiesService.getScriptProperties().getProperty('PLANILHA')) prepararPlanilha_();
    switch (req.acao) {
      case 'enviar': return json_(enviarPedido_(req));
      case 'listar': return json_(listarPedidos_(req));
      case 'baixar': return json_(baixarNota_(req));
      default: return json_({ ok: false, erro: 'Ação desconhecida' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, erro: 'Erro no servidor: ' + err.message });
  }
}

function doGet() {
  return json_({ ok: true, servico: 'Solicitar NFS-e' });
}

function enviarPedido_(req) {
  const d = req.dados || {};
  const protocolo = String(req.protocolo || '').replace(/[^0-9A-Z-]/gi, '').slice(0, 30);
  const cnpj = soDoc_(d.emitenteCnpj);
  if (!protocolo || !req.texto || !d.tomadorNome || cnpj.length !== 14) {
    return { ok: false, erro: 'Pedido incompleto.' };
  }

  // Anexos: confere quantidade e tamanho antes de gravar qualquer coisa
  const anexos = (req.anexos || []).slice(0, MAX_ANEXOS + 1);
  if (anexos.length > MAX_ANEXOS) return { ok: false, erro: 'Máximo de ' + MAX_ANEXOS + ' anexos.' };
  let total = 0;
  const blobs = anexos.map(function (a) {
    const bytes = Utilities.base64Decode(String(a.base64 || ''));
    total += bytes.length;
    const nome = String(a.nome || 'anexo').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
    return Utilities.newBlob(bytes, a.tipo || 'application/octet-stream', nome);
  });
  if (total > MAX_BYTES_ANEXOS) return { ok: false, erro: 'Anexos passam de 10 MB.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const aba = abrirAba_(ABA_PEDIDOS);
    // Reenvio do mesmo pedido (ex.: internet caiu na resposta): não duplica
    if (acharLinha_(aba, protocolo, cnpj)) return { ok: true, protocolo: protocolo, repetido: true };

    const nomeEmpresa = String(d.emitenteRazao || '').replace(/[\\/]/g, '-').slice(0, 80) + ' [' + cnpj + ']';
    const pastaEmpresa = subpasta_(DriveApp.getFolderById(prop_('PASTA_RAIZ')), nomeEmpresa);
    const pastaPedido = pastaEmpresa.createFolder(protocolo + ' - ' + String(d.tomadorNome).slice(0, 60));
    const pastaAnexos = pastaPedido.createFolder(PASTA_ANEXOS);
    const pastaNfs = pastaPedido.createFolder(PASTA_NFS);
    blobs.forEach(function (b) { pastaAnexos.createFile(b); });

    const solicitante = [req.contato, req.fone].filter(Boolean).join(' — ');
    aba.appendRow([
      new Date(), protocolo, celula_(d.emitenteRazao), celula_(d.emitenteCnpj), celula_(solicitante),
      celula_(d.tomadorNome), celula_(d.tomadorDoc), Number(d.valorNumero) || celula_(d.valor),
      d.urgente ? 'Sim' : '', 'Recebido', '', pastaPedido.getUrl(), pastaNfs.getId(), JSON.stringify(d),
    ]);

    const assunto = String(req.assunto || ('Pedido NFS-e ' + protocolo)).slice(0, 200);
    const corpo = req.texto + '\n\n--\nPasta do pedido: ' + pastaPedido.getUrl() +
      '\nColoque o PDF da nota na subpasta "' + PASTA_NFS + '" para o cliente ver no app.';
    MailApp.sendEmail({ to: EMAIL_ESCRITORIO, subject: assunto, body: corpo, name: 'App NFS-e', attachments: blobs });

    return { ok: true, protocolo: protocolo };
  } finally {
    lock.releaseLock();
  }
}

function listarPedidos_(req) {
  const cnpjs = {};
  (req.cnpjs || []).slice(0, MAX_CNPJS_POR_CONSULTA).forEach(function (c) {
    c = soDoc_(c);
    if (c.length === 14) cnpjs[c] = true;
  });
  if (!Object.keys(cnpjs).length) return { ok: false, erro: 'Nenhum CNPJ informado.' };

  const aba = abrirAba_(ABA_PEDIDOS);
  const n = aba.getLastRow() - 1;
  if (n < 1) return { ok: true, pedidos: [] };
  const linhas = aba.getRange(2, 1, n, COL_PEDIDOS.length).getValues()
    .filter(function (l) { return cnpjs[soDoc_(l[C['CNPJ emitente']])]; })
    .slice(-MAX_PEDIDOS_LISTADOS)
    .reverse();

  const pedidos = linhas.map(function (l) {
    const notas = [];
    try {
      const it = DriveApp.getFolderById(l[C['ID pasta NFS']]).getFiles();
      while (it.hasNext()) {
        const f = it.next();
        if (!f.isTrashed()) notas.push({ id: f.getId(), nome: f.getName() });
      }
    } catch (err) { /* pasta apagada: segue sem notas */ }
    let status = l[C['Status']] || 'Recebido';
    if (notas.length && status !== 'Cancelado') status = 'Emitida';
    return {
      protocolo: l[C['Protocolo']],
      data: l[C['Data']] instanceof Date ? l[C['Data']].toISOString() : String(l[C['Data']]),
      emitente: l[C['Emitente']],
      cnpjEmitente: l[C['CNPJ emitente']],
      tomador: l[C['Tomador']],
      valor: l[C['Valor']],
      status: status,
      mensagem: l[C['Mensagem ao cliente']],
      notas: notas,
    };
  });
  return { ok: true, pedidos: pedidos };
}

function baixarNota_(req) {
  const linha = acharLinha_(abrirAba_(ABA_PEDIDOS), String(req.protocolo || ''), soDoc_(req.cnpj));
  if (!linha) return { ok: false, erro: 'Pedido não encontrado.' };
  // Só entrega arquivos da pasta "NFS-e emitida" deste pedido (nunca os anexos do cliente)
  const it = DriveApp.getFolderById(linha[C['ID pasta NFS']]).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getId() === req.arquivoId && !f.isTrashed()) {
      const blob = f.getBlob();
      return { ok: true, nome: f.getName(), tipo: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
    }
  }
  return { ok: false, erro: 'Arquivo não encontrado.' };
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------
function soDoc_(s) {
  return String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function acharLinha_(aba, protocolo, cnpj) {
  const n = aba.getLastRow() - 1;
  if (n < 1 || !protocolo || cnpj.length !== 14) return null;
  const linhas = aba.getRange(2, 1, n, COL_PEDIDOS.length).getValues();
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (linhas[i][C['Protocolo']] === protocolo && soDoc_(linhas[i][C['CNPJ emitente']]) === cnpj) return linhas[i];
  }
  return null;
}

function subpasta_(pai, nome) {
  const it = pai.getFoldersByName(nome);
  return it.hasNext() ? it.next() : pai.createFolder(nome);
}

function abrirAba_(nome) {
  return SpreadsheetApp.openById(prop_('PLANILHA')).getSheetByName(nome);
}

function prop_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Planilha não configurada. Use o menu NFS-e > Configurar.');
  return v;
}

// Evita que texto vindo do app vire fórmula na planilha
function celula_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
