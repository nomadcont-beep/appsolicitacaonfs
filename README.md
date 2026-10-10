# Solicitar NFS-e

App para o cliente do escritório pedir a emissão de nota fiscal de serviço.
O cliente abre pelo ícone na área de trabalho, preenche o pedido e clica em enviar.
O pedido chega por e-mail em **fiscal@nomadcontabilidade.com.br**.

## O que o cliente preenche

- **Tomador:** CPF/CNPJ (validado, aceita o CNPJ alfanumérico), nome, e-mail, telefone, endereço (busca pelo CEP)
- **Serviço:** descrição, valor, data de competência, cidade da prestação e, se for obra de construção civil, o código da obra (CNO)
- **Retenções:** não / sim (ISS, IR, INSS, PIS/COFINS/CSLL) / não sei
- **Pagamento e observações:** vencimento, informações extras na nota, urgência

Também tem:
- **Clientes guardados:** o tomador fica salvo e é escolhido numa lista no próximo pedido
- **Histórico** com protocolo, "Pedir outra igual" (para notas mensais repetidas) e reenvio se a internet falhar
- **Rascunho automático:** se fechar sem querer, o que foi digitado não se perde

Os dados ficam só no computador do cliente. O escritório recebe apenas o e-mail.

## Configuração

Tudo fica em `config.js`: nome do escritório, e-mail, forma de envio e prazo.

### Forma de envio

| `envio` | Como funciona | Quando usar |
|---|---|---|
| `"formsubmit"` | Serviço gratuito FormSubmit.co envia o e-mail | Para começar já. No **1º pedido** chega um e-mail de ativação em fiscal@: clique em *Activate* uma vez. Os dados passam por um terceiro. |
| `"enviar.php"` | Script próprio na sua hospedagem envia o e-mail | **Recomendado** assim que estiver hospedado (Hostinger etc.). Não passa por terceiro. Ajuste `REMETENTE` no `enviar.php` para uma caixa que exista no seu domínio. |

## Publicar e instalar no cliente

1. Hospede a pasta em um endereço **https** (Hostinger, por ex. `nfs.nomadcontabilidade.com.br`).
2. No computador do cliente, abra o endereço no **Chrome ou Edge** e clique em **"Instalar na área de trabalho"**
   (ou no ícone de instalar na barra de endereço). Fica um ícone na área de trabalho e o app abre em janela própria.
3. Opcional: mande o link já com os dados da empresa do cliente, para ele não digitar:
   `https://seu-endereco/?razao=Empresa%20X%20Ltda&cnpj=11222333000181&contato=Maria`

Ao alterar arquivos depois de publicado, aumente `VERSAO` em `sw.js` para os clientes receberem a atualização.

## Testar localmente

```
python3 -m http.server 8000
```
e abra http://localhost:8000
