# Checklist semanal

## Fluxo

- A partir de Hoje, arrastar para a direita abre a checklist. Outro gesto para a direita abre o calendário. Os gestos para a esquerda retornam uma tela por vez.
- Arrastar para a esquerda a partir de Hoje continua abrindo o banco. O retorno do banco continua disponível na primeira coluna.
- Há também um botão de checklist no cabeçalho. A navegação abaixo da lista usa somente gestos; os botões Hoje/Calendário foram removidos.
- As linhas compactas mostram ícone de origem (banco ou manual), categoria e prioridade quando definida. Itens manuais aparecem como “Sem categoria”.
- O seletor “Ordenar por” permite ordem de inclusão, prioridade alta/baixa, nome e categoria em ambos os sentidos. A preferência é salva no aparelho e não altera a ordem armazenada dos itens. Itens sem prioridade ficam ao final na ordenação por prioridade.
- Tocar no título de uma tarefa vinculada abre o modal original do banco. Fechar o modal retorna à checklist; checkbox e botão de remoção mantêm suas ações próprias.
- A semana vai de segunda a domingo, pelo fuso America/Sao_Paulo.
- Itens manuais pertencem somente à checklist. Tarefas com `isTracked` entram vinculadas pelo ID; nomes iguais não são usados para identificar tarefas.
- Pressionar e segurar continua alternando o destaque no banco e passa a incluir/remover a tarefa na checklist. Destaques existentes são importados.
- Marcar um item vinculado abre a pergunta sobre concluir também a tarefa no banco. Recusar mantém apenas o check semanal. Aceitar aplica o mesmo status/data e conclusão das subtarefas usados no aplicativo.
- Desmarcar um item semanal não desfaz a conclusão no banco.
- Encerrada a semana, a tabela fica cinza e bloqueada. “Começar nova semana” remove da checklist os itens checados e mantém os pendentes, mesmo após várias semanas sem acesso. As tarefas originais não são excluídas por essa renovação.
- Ao remover um item vinculado da semana, seu destaque no banco é retirado. Excluir uma tarefa no banco preserva a anotação na checklist como item sem tarefa disponível.

## Persistência e ativação

A conta real usa o documento `weekly_checklists/{uid}` no Firestore. A demonstração usa armazenamento local separado (`rotinaos.weekly.demo.v1`) e não escreve no Firebase.

**Antes de publicar o aplicativo, publique a regra da nova coleção no projeto Firebase.** O arquivo `firestore.rules` foi alinhado às regras atuais fornecidas pelo proprietário em 05/11/2026. Preserva as regras de `activities`, `activity_occurrences` e o bloqueio padrão, acrescentando este bloco:

```text
match /weekly_checklists/{userId} {
  allow create: if ownsIncomingDocument() && userId == request.auth.uid;
  allow read: if signedIn() && userId == request.auth.uid;
  allow delete: if ownsExistingDocument() && userId == request.auth.uid;
  allow update: if ownsExistingDocument() && ownsIncomingDocument()
    && userId == request.auth.uid;
}
```

A leitura da checklist usa o UID no caminho, inclusive quando o documento ainda não existe. Isso permite a leitura inicial usada pela transação que cria a primeira semana. Criação e atualização também conferem o campo `userId`.

As regras fornecidas pelo proprietário foram usadas como referência; a publicação no projeto Firebase não foi realizada nesta implementação.

As gravações da checklist na conta real exigem conexão: usam transações para ler a semana atual antes de alterar itens, renovar a lista ou atualizar a tarefa vinculada. Sem conexão, documentos já armazenados pelo Firestore permanecem consultáveis e a interface informa que é necessário reconectar para editar. A demonstração pode editar localmente sem rede.

O Service Worker foi atualizado para `todo-os-cache-v43` com os novos módulos e estilos. Sem a nova regra, a checklist informa o erro de acesso; o recurso não pode ser considerado ativado apenas pela publicação dos arquivos estáticos.

## Validação

```sh
npm ci
npm test
```

Os testes cobrem datas e fuso, inclusão manual, migração dos destaques, confirmação de conclusão, renovação, remoção de vínculos, tarefas excluídas, gestos e toque longo com títulos duplicados. As interações usam DOM e Firestore simulados. Não substituem uma verificação no dispositivo nem a validação das regras no projeto real.
