# Solicitar NFS-e

App para o cliente do escritório pedir a emissão de nota fiscal de serviço e receber o PDF da nota.
O cliente abre pelo ícone na área de trabalho, preenche o pedido, anexa documentos e envia.
O escritório recebe por e-mail em **fiscal@nomadcontabilidade.com.br**, emite e salva o PDF no Google Drive.
A nota aparece para o cliente em **Minhas notas**.

## Como funciona

```
App do cliente  ──pedido + anexos──►  Script Google  ──►  Planilha "Pedidos" + pasta no Drive + e-mail fiscal@
                ◄──status + PDF────                 ◄──  escritório salva o PDF em "NFS-e emitida"
```

- **Frontend** (esta pasta): página estática instalável (PWA), publicada no GitHub Pages.
  Marca: `logo.png` (recorte de `marca/logo-original.png`), cores laranja `#ff6e00` e grafite `#1f2329`.
- **Servidor** (`google/Codigo.gs`): Google Apps Script ligado a uma planilha do escritório.
  Instalação em [`google/COMO-INSTALAR.md`](google/COMO-INSTALAR.md).

## O que o cliente faz

- **Meus dados:** nome, telefone e **uma ou várias empresas** (CNPJs).
- **Nova solicitação:**
  - empresa que emite (quando houver mais de uma);
  - tomador: CPF/CNPJ (validado, aceita o CNPJ alfanumérico), nome, e-mail, telefone e endereço (busca pelo CEP);
  - serviço: descrição, valor, competência, local da prestação e, se for obra, o código da obra (CNO);
  - retenções, vencimento, informações extras na nota, observações e urgência;
  - **anexos:** até 5 arquivos, 10 MB no total.
- **Minhas notas:** status de cada pedido, recados do escritório, **PDF da nota** (ver e baixar) e "Pedir outra igual".

Obrigatórios: empresa emitente, CPF/CNPJ e nome do tomador, descrição, valor, competência,
local da prestação e CNO (quando for obra).

## Segurança

- **Sem senha nem código de acesso** (decisão do escritório): o app identifica o cliente pelos CNPJs
  cadastrados. Quem souber um CNPJ vê os pedidos daquele CNPJ (tomador, valor, status) e baixa os PDFs.
- Para reduzir a exposição, o script **não devolve** endereço, e-mail e telefone dos tomadores nem
  os anexos do cliente; só entrega arquivos da pasta "NFS-e emitida" do pedido.
- Texto vindo do app não vira fórmula na planilha.
- No computador do cliente ficam só os dados dele (empresas e tomadores frequentes).

## Configuração

Em `config.js`: nome do escritório, e-mail, `apiUrl` (endereço `/exec` do script do Google) e prazo.

## Publicar e instalar no cliente

1. GitHub Pages: Settings > Pages > Deploy from a branch > `claude/nfs-request-app-p1kh1a` / root.
   Endereço: `https://nomadcont-beep.github.io/appsolicitacaonfs/`
2. Escritório manda o link ao cliente.
3. Cliente: abre o link no **Chrome ou Edge**, preenche Meus dados e clica em **"Instalar na área de trabalho"**.

Ao alterar arquivos depois de publicado, aumente `VERSAO` em `sw.js` para os clientes receberem a atualização.

## Testar localmente

```
python3 -m http.server 8000
```
e abra http://localhost:8000
