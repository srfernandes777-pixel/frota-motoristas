# Registros da Frota

Aplicativo estático para motoristas, configurado em `config.js` e servido por HTTPS.

## Manutenção

Após entrar com PIN, o motorista escolhe manualmente um caminhão cadastrado, sem depender de escala. Sem sinal, a lista de veículos salva anteriormente pode ser usada, com aviso de que está desatualizada. O servidor valida a placa ao enviar; se ela tiver sido removida, o relato permanece na fila e o responsável deve revisar o cadastro.

Relatos e evidências ficam na fila local até a confirmação do servidor. Fotos JPEG, PNG ou WebP podem ter até 5 MiB cada (máximo de cinco); um vídeo MP4, WebM ou MOV pode ter até 15 segundos e 20 MiB. O aparelho precisa conseguir verificar a duração do vídeo. Os arquivos são enviados em partes e retomados após interrupções. O histórico e a confirmação de visualização exigem conexão.

O app guarda no celular a tela, o veículo e os rascunhos por motorista e caminhão, inclusive fotos e vídeos ainda não enviados. Ao retornar, retoma o trabalho se a sessão ainda estiver ativa; após trocar de motorista ou uma sessão expirada é necessário entrar novamente. Rascunhos não são enviados até a confirmação. O navegador pode impedir ou apagar o armazenamento local; nesse caso, o app avisa quando não consegue salvar o progresso, e a fila local também depende do armazenamento do aparelho.

Antes de publicar esta versão do app, aplique no banco a migração administrativa `schema_v8_manutencao_sem_turno.sql` após a v7. As RPCs `app_enviar_manutencao`, `app_anexar_manutencao`, `app_manutencoes` e `app_historico_manutencao` validam a sessão via `_sessao(p_token)`; a v8 aceita relatos novos por placa e mantém suporte aos relatos antigos com `turno_id` ainda na fila. O sistema administrativo mantém a visualização e a conclusão das manutenções; a mídia deve permanecer privada.

Execute também `supabase_app_ultimos_abastecimentos.sql` no Supabase para que a consulta apresente o último abastecimento conhecido mesmo fora dos últimos 30 dias. Sem essa atualização, o aplicativo só pode mostrar os registros disponibilizados pela versão instalada da função.

O tema inicialmente acompanha o sistema operacional. Ao selecionar o tema claro ou escuro, a escolha fica guardada no navegador.

Para executar os testes locais, use `node --test tests\driver-workflow.test.js`.
