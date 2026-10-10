<?php
// ============================================================
//  Recebe o pedido do app e envia por e-mail ao escritório.
//  Use quando o app estiver hospedado num servidor com PHP (ex.: Hostinger)
//  e, em config.js, troque  envio: "formsubmit"  por  envio: "enviar.php".
// ============================================================

// E-mail que recebe os pedidos
const DESTINO = 'fiscal@nomadcontabilidade.com.br';

// Remetente: precisa ser uma caixa que EXISTA no mesmo domínio da hospedagem,
// senão o provedor bloqueia ou o e-mail cai no spam.
const REMETENTE = 'app-nfs@nomadcontabilidade.com.br';

header('Content-Type: application/json; charset=utf-8');

function responder(int $status, array $dados): void {
    http_response_code($status);
    echo json_encode($dados, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    responder(405, ['ok' => false, 'erro' => 'Método não permitido']);
}

$bruto = file_get_contents('php://input', false, null, 0, 50000);
$p = json_decode($bruto, true);
if (!is_array($p) || empty($p['texto']) || empty($p['protocolo'])) {
    responder(400, ['ok' => false, 'erro' => 'Pedido incompleto']);
}

// Remove quebras de linha de tudo que vai para cabeçalho (evita injeção de cabeçalhos)
$limpaCab = fn($s) => trim(preg_replace('/[\r\n]+/', ' ', (string)$s));

$assunto  = mb_substr($limpaCab($p['assunto'] ?? ('Pedido NFS-e ' . $p['protocolo'])), 0, 200);
$texto    = mb_substr((string)$p['texto'], 0, 20000);
$texto   .= "\n\n--\nEnviado pelo app Solicitar NFS-e em " . date('d/m/Y H:i')
          . ' — IP ' . ($_SERVER['REMOTE_ADDR'] ?? '?');

$cabecalhos = [
    'From: App NFS-e <' . REMETENTE . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
];

$ok = mail(
    DESTINO,
    '=?UTF-8?B?' . base64_encode($assunto) . '?=',
    $texto,
    implode("\r\n", $cabecalhos)
);

if (!$ok) {
    responder(500, ['ok' => false, 'erro' => 'O servidor não conseguiu enviar o e-mail']);
}
responder(200, ['ok' => true]);
