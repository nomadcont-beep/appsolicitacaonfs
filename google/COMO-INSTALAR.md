# Instalar a parte do Google (uma vez só, ~15 minutos)

A planilha é o controle do escritório. O Google Drive guarda os anexos e as notas.
O app do cliente conversa com os dois por meio de um script (Apps Script).

> Use a conta Google do escritório: o ideal é a própria **fiscal@nomadcontabilidade.com.br**,
> se ela for Google Workspace. Os arquivos ficam no Drive dessa conta, e os e-mails de pedido
> saem dela para ela mesma.

## 1. Criar a planilha
1. Abra https://sheets.new (já logado na conta do escritório).
2. Dê o nome **Pedidos NFS-e**.

## 2. Colar o script
1. Na planilha: **Extensões > Apps Script**.
2. Apague o que estiver escrito e cole todo o conteúdo do arquivo `google/Codigo.gs`.
3. Clique no disquete (**Salvar**). Se ele pedir um nome para o projeto, use **App NFS-e**.

## 3. Configurar
1. Volte à planilha e aperte **F5**. Aparece o menu **NFS-e** no alto.
2. **NFS-e > 1. Configurar**.
3. O Google pede autorização. É normal para scripts próprios:
   **Continuar** → escolha a conta → **Avançado** → **Acessar App NFS-e (não seguro)** → **Permitir**.
4. Rode **NFS-e > 1. Configurar** de novo, se ele não tiver continuado sozinho.
5. Quando pedir o endereço do app, cole `https://nomadcont-beep.github.io/appsolicitacaonfs/`.

Ao terminar, aparecem as abas **Clientes** e **Pedidos**, e no Drive a pasta **Pedidos NFS-e (app)**.

## 4. Publicar o script
1. No Apps Script: **Implantar > Nova implantação**.
2. Na engrenagem ao lado de "Selecionar tipo", escolha **App da Web**.
3. **Executar como:** Eu. **Quem pode acessar:** Qualquer pessoa.
4. **Implantar**. Copie o **URL do app da Web** (termina em `/exec`).
5. Esse endereço vai no `config.js` do app, no campo `apiUrl`. Mande para o Claude ou edite direto no GitHub.

"Qualquer pessoa" significa que o app consegue chamar o script. Os dados continuam protegidos
pelo código de acesso de cada cliente: sem código válido, o script não responde nada.

## Dia a dia

**Cadastrar um cliente:** **NFS-e > Novo cliente**, digite o nome. Aparece o código e o link.
Mande o link ao cliente: ao abrir, o código já vem preenchido.

**Quando chega um pedido:**
1. O e-mail chega em fiscal@ com os anexos e o link da pasta do pedido.
2. Emita a nota normalmente.
3. Salve o PDF da nota na subpasta **NFS-e emitida** daquele pedido.
   O status muda sozinho para **Emitida** e o PDF aparece em "Minhas notas" no app do cliente.

**Status e recados:** na aba **Pedidos**, a coluna **Status** tem as opções Recebido / Em emissão /
Pendente / Emitida / Cancelado. O que for escrito em **Mensagem ao cliente** aparece no app
(ex.: "Falta o número da ART").

**Bloquear um cliente:** aba **Clientes**, coluna **Ativo** = Não.

**Atualizar o script** (quando houver versão nova): cole o novo código, salve e vá em
**Implantar > Gerenciar implantações > lápis (editar) > Versão: Nova versão > Implantar**.
Assim o endereço `/exec` continua o mesmo e os clientes não precisam fazer nada.

## Limites do Google
- E-mails enviados pelo script por dia: **100** numa conta Gmail comum e **1.500** no Google Workspace.
  Cada pedido gasta 1.
- Anexos: até 5 arquivos e 10 MB por pedido (limite definido no app).
