# Instalar a parte do Google (uma vez só, ~15 minutos)

A planilha é o controle do escritório. O Google Drive guarda os anexos e as notas.
O app do cliente conversa com os dois por meio de um script (Apps Script).

> Use a conta Google do escritório: o ideal é a própria **fiscal@nomadcontabilidade.com.br**,
> se ela for Google Workspace. Os arquivos ficam no Drive dessa conta, e os e-mails de pedido
> saem dela para ela mesma.

## 1. Criar a planilha
1. Abra https://sheets.new (já logado na conta do escritório).
2. Clique em "Planilha sem título", no alto à esquerda, e dê o nome **Pedidos NFS-e**.

## 2. Colar o script
1. Na planilha, menu **Extensões > Apps Script**. Abre uma aba nova com um editor de código.
2. Em outra aba, abra o código pronto:
   https://raw.githubusercontent.com/nomadcont-beep/appsolicitacaonfs/claude/nfs-request-app-p1kh1a/google/Codigo.gs
   Aperte **Ctrl+A** (seleciona tudo) e **Ctrl+C** (copia).
3. Volte ao editor do Apps Script, clique dentro da área de código, aperte **Ctrl+A** e depois **Ctrl+V**.
   O texto que estava lá (`function myFunction() {...}`) deve sumir e ficar só o código colado.
4. Aperte **Ctrl+S** para salvar.

## 3. Configurar e autorizar
1. Na barra de cima do editor há uma caixinha com o nome de uma função, ao lado de **Executar**.
   Escolha **configurar** nela e clique em **Executar**.
2. O Google pede autorização. É normal para scripts próprios:
   **Revisar permissões** → escolha a conta → aparece "O Google não verificou este app" →
   clique em **Avançado** → **Acessar App NFS-e (não seguro)** → **Permitir**.
3. Embaixo aparece o registro de execução, terminando em **"Execução concluída"**.
   Na planilha surge a aba **Pedidos** e, no Drive, a pasta **Pedidos NFS-e (app)**.

Se pular esta etapa, o script se configura sozinho no primeiro pedido. Mesmo assim, vale fazer
agora, porque é aqui que você vê se a autorização deu certo.

## 4. Publicar o script
1. No editor, botão azul **Implantar** (canto de cima à direita) → **Nova implantação**.
2. Clique na engrenagem ao lado de "Selecionar tipo" e escolha **App da Web**.
3. **Executar como:** Eu. **Quem pode acessar:** Qualquer pessoa.
4. **Implantar**. Se pedir autorização de novo, repita o passo 3.2.
5. Copie o **URL do app da Web** (começa com `https://script.google.com/macros/s/` e termina em `/exec`).
6. Mande esse endereço para o Claude, que coloca no app.

## Se travar
| O que aparece | O que fazer |
|---|---|
| Não acho "Extensões" | O menu fica na planilha (não no Drive), entre "Dados" e "Ajuda". |
| "Este app está bloqueado" | A conta é Google Workspace e o administrador bloqueia scripts. Peça a liberação ao administrador ou use uma conta Gmail do escritório. |
| Erro "SyntaxError" ao salvar | O código não foi colado inteiro. Repita o passo 2 com Ctrl+A antes de copiar e antes de colar. |
| A caixinha não mostra "configurar" | Salve (Ctrl+S) e recarregue a página do editor. |

"Qualquer pessoa" significa que o app consegue chamar o script.

> **Atenção (decisão do escritório):** não há senha nem código de acesso. O app identifica o
> cliente pelos CNPJs cadastrados em "Meus dados". Quem souber o CNPJ de um cliente consegue
> ver a lista de pedidos dele (tomador, valor, status) e baixar os PDFs das notas.
> Endereço, e-mail e telefone dos tomadores e os anexos enviados pelo cliente **não** são
> devolvidos pelo app — ficam só na planilha e no Drive do escritório.

## Dia a dia

**Cadastrar um cliente:** não precisa. Mande o link do app; o cliente preenche nome e CNPJs
em "Meus dados" e instala na área de trabalho.

**Quando chega um pedido:**
1. O e-mail chega em fiscal@ com os anexos e o link da pasta do pedido.
2. Emita a nota normalmente.
3. Salve o PDF da nota na subpasta **NFS-e emitida** daquele pedido.
   O status muda sozinho para **Emitida** e o PDF aparece em "Minhas notas" no app do cliente.

**Status e recados:** na aba **Pedidos**, a coluna **Status** tem as opções Recebido / Em emissão /
Pendente / Emitida / Cancelado. O que for escrito em **Mensagem ao cliente** aparece no app
(ex.: "Falta o número da ART").

**Atualizar o script** (quando houver versão nova): cole o novo código, salve e vá em
**Implantar > Gerenciar implantações > lápis (editar) > Versão: Nova versão > Implantar**.
Assim o endereço `/exec` continua o mesmo e os clientes não precisam fazer nada.

## Limites do Google
- E-mails enviados pelo script por dia: **100** numa conta Gmail comum e **1.500** no Google Workspace.
  Cada pedido gasta 1.
- Anexos: até 5 arquivos e 10 MB por pedido (limite definido no app).
