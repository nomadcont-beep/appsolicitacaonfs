// ============================================================
//  CONFIGURAÇÃO DO ESCRITÓRIO — edite só este arquivo
// ============================================================
window.APP_CONFIG = {
  // Nome que aparece no topo do app
  nomeEscritorio: "Nomad Contabilidade",

  // E-mail que recebe os pedidos
  email: "fiscal@nomadcontabilidade.com.br",

  // Para onde o app envia o pedido (envio automático, sem abrir Outlook):
  //  - "formsubmit": serviço gratuito FormSubmit.co. Funciona na hora, mas os
  //    dados passam por um terceiro. No 1º pedido chega um e-mail de ativação
  //    no endereço acima — é preciso clicar em "Activate" uma única vez.
  //  - "enviar.php": script próprio (incluído neste projeto) rodando na sua
  //    hospedagem (ex.: Hostinger). Os dados não passam por terceiros.
  //    Recomendado assim que o app estiver hospedado.
  envio: "formsubmit",

  // Prazo informado ao cliente após o envio
  prazoAtendimento: "Emitimos em até 1 dia útil. Pedidos recebidos após as 16h entram no dia seguinte.",
};
