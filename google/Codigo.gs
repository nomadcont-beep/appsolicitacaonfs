/**
 * Servidor do app "Solicitar NFS-e" — roda no Google Apps Script, ligado à planilha do escritório.
 *
 * O que faz:
 *  - recebe os pedidos do app, grava na aba "Pedidos", cria uma pasta no Drive para cada pedido
 *    (com os anexos do cliente) e manda um e-mail para o escritório;
 *  - devolve ao cliente a lista dos pedidos dele, com status e os PDFs que o escritório colocou
 *    na subpasta "NFS-e emitida" de cada pedido.
 *
 * Instalação: veja google/COMO-INSTALAR.md
 */

// ===================== CONFIGURAÇÃO =====================
const EMAIL_ESCRITORIO = 'fiscal@nomadcontabilidade.com.br';
const NOME_PASTA_RAIZ = 'Pedidos NFS-e (app)';
const MAX_ANEXOS = 5;
const MAX_BYTES_ANEXOS = 10 * 1024 * 1024; // 10 MB somando todos
const MAX_PEDIDOS_LISTADOS = 60;
// ========================================================

const ABA_CLIENTES = 'Clientes';
const ABA_PEDIDOS = 'Pedidos';
const PASTA_ANEXOS = 'Anexos do cliente';
const PASTA_NFS = 'NFS-e emitida';
const STATUS = ['Recebido', 'Em emissão', 'Pendente (ver mensagem)', 'Emitida', 'Cancelado'];

const COL_CLIENTES = ['Código de acesso', 'Cliente', 'Ativo', 'Criado em', 'Observações'];
const COL_PEDIDOS = ['Data', 'Protocolo', 'Código', 'Cliente', 'Emitente', 'CNPJ emitente', 'Tomador',
  'CPF/CNPJ tomador', 'Valor', 'Urgente', 'Status', 'Mensagem ao cliente', 'Pasta no Drive', 'ID pasta NFS', 'Dados'];
const C = Object.fromEntries(COL_PEDIDOS.map((n, i) => [n, i]));

// ---------------------------------------------------------------------------
// Menu da planilha
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('NFS-e')
    .addItem('1. Configurar (só na primeira vez)', 'configurar')
    .addItem('Novo cliente (gera código de acesso)', 'novoCliente')
    .addToUi();
}

function configurar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  let cli = ss.getSheetByName(ABA_CLIENTES) || ss.insertSheet(ABA_CLIENTES);
  if (cli.getLastRow() === 0) {
    cli.appendRow(COL_CLIENTES);
    cli.getRange(1, 1, 1, COL_CLIENTES.length).setFontWeight('bold');
    cli.setFrozenRows(1);
    cli.getRange('A:A').setNumberFormat('@');
    cli.getRange('C2:C').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Sim', 'Não']).build());
  }

  let ped = ss.getSheetByName(ABA_PEDIDOS) || ss.insertSheet(ABA_PEDIDOS);
  if (ped.getLastRow() === 0) {
    ped.appendRow(COL_PEDIDOS);
    ped.getRange(1, 1, 1, COL_PEDIDOS.length).setFontWeight('bold');
    ped.setFrozenRows(1);
    ped.getRange('B:C').setNumberFormat('@');   // protocolo e código sempre como texto
    ped.getRange(1, C['Valor'] + 1, ped.getMaxRows(), 1).setNumberFormat('"R$" #,##0.00');
    const colStatus = C['Status'] + 1;
    ped.getRange(2, colStatus, ped.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUS).build());
    ped.hideColumns(C['ID pasta NFS'] + 1, 2); // colunas técnicas
  }

  if (!props.getProperty('PASTA_RAIZ')) {
    props.setProperty('PASTA_RAIZ', DriveApp.createFolder(NOME_PASTA_RAIZ).getId());
  }
  props.setProperty('PLANILHA', ss.getId());

  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Endereço do app',
    'Cole o endereço onde o app está publicado (ex.: https://nomadcont-beep.github.io/appsolicitacaonfs/).\n' +
    'Ele é usado para montar o link que você manda para cada cliente. Pode deixar em branco.',
    ui.ButtonSet.OK);
  if (r.getSelectedButton() === ui.Button.OK && r.getResponseText().trim()) {
    props.setProperty('APP_URL', r.getResponseText().trim());
  }
  ui.alert('Pronto. Abas e pasta "' + NOME_PASTA_RAIZ + '" criadas no seu Google Drive.\n\n' +
    'Agora publique o script: Implantar > Nova implantação > App da Web.');
}

function novoCliente() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Novo cliente', 'Nome do cliente (como vocês o identificam):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;

  const codigo = gerarCodigo_();
  abrirAba_(ABA_CLIENTES).appendRow([codigo, celula_(r.getResponseText().trim()), 'Sim', new Date(), '']);

  const appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL');
  const link = appUrl ? appUrl + (appUrl.indexOf('?') < 0 ? '?' : '&') + 'codigo=' + codigo : '';
  ui.alert('Código de acesso: ' + codigo + (link ? '\n\nLink para enviar ao cliente:\n' + link : ''));
}

// ---------------------------------------------------------------------------
// API usada pelo app
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const cliente = buscarCliente_(req.codigo);
    if (!cliente) return json_({ ok: false, erro: 'Código de acesso inválido. Fale com o escritório.' });

    switch (req.acao) {
      case 'validar': return json_({ ok: true, cliente: cliente.nome });
      case 'enviar': return json_(enviarPedido_(cliente, req));
      case 'listar': return json_(listarPedidos_(cliente));
      case 'baixar': return json_(baixarNota_(cliente, req));
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

function enviarPedido_(cliente, req) {
  const d = req.dados || {};
  const protocolo = String(req.protocolo || '').replace(/[^0-9A-Z-]/gi, '').slice(0, 30);
  if (!protocolo || !req.texto || !d.tomadorNome || !d.emitenteCnpj) {
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
    if (acharLinha_(aba, protocolo, cliente.codigo)) return { ok: true, protocolo: protocolo, repetido: true };

    const pastaCliente = subpasta_(DriveApp.getFolderById(prop_('PASTA_RAIZ')), cliente.nome + ' [' + cliente.codigo + ']');
    const pastaPedido = pastaCliente.createFolder(protocolo + ' - ' + String(d.tomadorNome).slice(0, 60));
    const pastaAnexos = pastaPedido.createFolder(PASTA_ANEXOS);
    const pastaNfs = pastaPedido.createFolder(PASTA_NFS);
    blobs.forEach(function (b) { pastaAnexos.createFile(b); });

    aba.appendRow([
      new Date(), protocolo, cliente.codigo, celula_(cliente.nome), celula_(d.emitenteRazao), celula_(d.emitenteCnpj),
      celula_(d.tomadorNome), celula_(d.tomadorDoc), Number(d.valorNumero) || celula_(d.valor),
      d.urgente ? 'Sim' : '', 'Recebido', '', pastaPedido.getUrl(), pastaNfs.getId(), JSON.stringify(d),
    ]);

    const assunto = String(req.assunto || ('Pedido NFS-e ' + protocolo)).slice(0, 200);
    const corpo = req.texto + '\n\n--\nCliente: ' + cliente.nome +
      '\nPasta do pedido: ' + pastaPedido.getUrl() +
      '\nColoque o PDF da nota na subpasta "' + PASTA_NFS + '" para o cliente ver no app.';
    MailApp.sendEmail({ to: EMAIL_ESCRITORIO, subject: assunto, body: corpo, name: 'App NFS-e', attachments: blobs });

    return { ok: true, protocolo: protocolo };
  } finally {
    lock.releaseLock();
  }
}

function listarPedidos_(cliente) {
  const aba = abrirAba_(ABA_PEDIDOS);
  const n = aba.getLastRow() - 1;
  if (n < 1) return { ok: true, pedidos: [] };
  const linhas = aba.getRange(2, 1, n, COL_PEDIDOS.length).getValues()
    .filter(function (l) { return l[C['Código']] === cliente.codigo; })
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
    let dados = {};
    try { dados = JSON.parse(l[C['Dados']] || '{}'); } catch (err) { /* ignora */ }
    return {
      protocolo: l[C['Protocolo']],
      data: l[C['Data']] instanceof Date ? l[C['Data']].toISOString() : String(l[C['Data']]),
      emitente: l[C['Emitente']],
      tomador: l[C['Tomador']],
      valor: l[C['Valor']],
      status: status,
      mensagem: l[C['Mensagem ao cliente']],
      notas: notas,
      dados: dados,
    };
  });
  return { ok: true, pedidos: pedidos };
}

function baixarNota_(cliente, req) {
  const linha = acharLinha_(abrirAba_(ABA_PEDIDOS), String(req.protocolo || ''), cliente.codigo);
  if (!linha) return { ok: false, erro: 'Pedido não encontrado.' };
  // Só entrega arquivos que estão na pasta de NFS-e deste pedido, deste cliente
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
function buscarCliente_(codigo) {
  codigo = String(codigo || '').trim().toUpperCase();
  if (!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(codigo)) return null;
  const aba = abrirAba_(ABA_CLIENTES);
  const n = aba.getLastRow() - 1;
  if (n < 1) return null;
  const linhas = aba.getRange(2, 1, n, 3).getValues();
  for (let i = 0; i < linhas.length; i++) {
    if (String(linhas[i][0]).trim().toUpperCase() === codigo && linhas[i][2] !== 'Não') {
      return { codigo: codigo, nome: String(linhas[i][1]) };
    }
  }
  return null;
}

function acharLinha_(aba, protocolo, codigo) {
  const n = aba.getLastRow() - 1;
  if (n < 1) return null;
  const linhas = aba.getRange(2, 1, n, COL_PEDIDOS.length).getValues();
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (linhas[i][C['Protocolo']] === protocolo && linhas[i][C['Código']] === codigo) return linhas[i];
  }
  return null;
}

function gerarCodigo_() {
  const hex = Utilities.getUuid().replace(/-/g, '').toUpperCase(); // UUID v4: aleatório
  return hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12);
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
