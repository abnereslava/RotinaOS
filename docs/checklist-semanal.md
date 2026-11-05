# Checklist semanal

## Fluxo

- A partir de Hoje, arrastar para a direita abre a checklist. Outro gesto para a direita abre o calendário. Os gestos para a esquerda retornam uma tela por vez.
- Arrastar para a esquerda a partir de Hoje continua abrindo o banco. O retorno do banco continua disponível na primeira coluna.
- Há também um botão de checklist no cabeçalho e botões Hoje/Calendário na tela semanal.
- A semana vai de segunda a domingo, pelo fuso America/Sao_Paulo.
- Itens manuais pertencem somente à checklist. Tarefas com `isTracked` entram vinculadas pelo ID; nomes iguais não são usados para identificar tarefas.
- Pressionar e segurar continua alternando o destaque no banco e passa a incluir/remover a tarefa na checklist. Destaques existentes são importados.
- Marcar um item vinculado abre a pergunta sobre concluir também a tarefa no banco. Recusar mantém apenas o check semanal. Aceitar aplica o mesmo status/data e conclusão das subtarefas usados no aplicativo.
- Desmarcar um item semanal não desfaz a conclusão no banco.
- Encerrada a semana, a tabela fica cinza e bloqueada. “Começar nova semana” remove da checklist os itens checados e mantém os pendentes, mesmo após várias semanas sem acesso. As tarefas originais não são excluídas por essa renovação.
- Ao remover um item vinculado da semana, seu destaque no banco é retirado. Excluir uma tarefa no banco preserva a anotação na checklist como item sem tarefa disponível.

## Persistência e ativação

A conta real usa o documento `weekly_checklists/{uid}` no Firestore. A demonstração usa armazenamento local separado (`rotinaos.weekly.demo.v1`) e não escreve no Firebase.

**Antes de publicar o aplicativo, publique a regra da nova coleção no projeto Firebase.** O arquivo `firestore.rules` continua sendo um template com `OWNER_EMAIL`; não deve substituir as regras reais sem preservar a configuração da conta proprietária. O bloco novo usa as mesmas funções de autorização já declaradas nesse template:

```text
match /weekly_checklists/{userId} {
  allow create: if ownsIncomingDocument() && userId == request.auth.uid;
  allow read, delete: if ownsExistingDocument() && userId == request.auth.uid;
  allow update: if ownsExistingDocument() && ownsIncomingDocument()
    && userId == request.auth.uid;
}
```

Mantenha as permissões das coleções existentes e o bloqueio de acesso a outros usuários. As regras publicadas no projeto não foram consultadas ou alteradas nesta implementação.

As gravações da checklist na conta real exigem conexão: usam transações para ler a semana atual antes de alterar itens, renovar a lista ou atualizar a tarefa vinculada. Sem conexão, documentos já armazenados pelo Firestore permanecem consultáveis e a interface informa que é necessário reconectar para editar. A demonstração pode editar localmente sem rede.

O Service Worker foi atualizado para `todo-os-cache-v42` com os novos módulos e estilos. Sem a nova regra, a checklist informa o erro de acesso; o recurso não pode ser considerado ativado apenas pela publicação dos arquivos estáticos.

## Validação

```sh
npm ci
npm test
```

Os testes cobrem datas e fuso, inclusão manual, migração dos destaques, confirmação de conclusão, renovação, remoção de vínculos, tarefas excluídas, gestos e toque longo com títulos duplicados. As interações usam DOM e Firestore simulados. Não substituem uma verificação no dispositivo nem a validação das regras no projeto real.
