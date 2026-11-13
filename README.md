# Registros da Frota

Aplicativo estático para motoristas, configurado em `config.js` e servido por HTTPS.

## Manutenção e turnos

Após entrar com PIN, o motorista escolhe uma escala publicada para a data desejada. O app usa a placa, rota e período dessa escala no relato. A consulta de escalas precisa de conexão ou de uma consulta anterior para o mesmo motorista e data; uma escala em cache pode estar desatualizada.

Relatos e evidências ficam na fila local até a confirmação do servidor. Fotos JPEG, PNG ou WebP podem ter até 5 MiB cada (máximo de cinco); um vídeo MP4, WebM ou MOV pode ter até 15 segundos e 20 MiB. O aparelho precisa conseguir verificar a duração do vídeo. Os arquivos são enviados em partes e retomados após interrupções. O histórico e a confirmação de visualização exigem conexão.

O servidor precisa implementar as RPCs `app_turnos`, `app_enviar_manutencao`, `app_anexar_manutencao`, `app_manutencoes` e `app_historico_manutencao`, usando a sessão de motorista validada por `_sessao(p_token)`. O sistema administrativo mantém as escalas, a visualização e a conclusão das manutenções; a mídia deve permanecer privada.

Execute também `supabase_app_ultimos_abastecimentos.sql` no Supabase para que a consulta apresente o último abastecimento conhecido mesmo fora dos últimos 30 dias. Sem essa atualização, o aplicativo só pode mostrar os registros disponibilizados pela versão instalada da função.

O tema inicialmente acompanha o sistema operacional. Ao selecionar o tema claro ou escuro, a escolha fica guardada no navegador.

Para executar os testes locais, use `node --test tests\driver-workflow.test.js`.
