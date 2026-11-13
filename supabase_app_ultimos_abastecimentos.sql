-- Histórico compartilhado: abastecimentos ativos dos veículos cadastrados
-- nos últimos 30 dias, mais o registro mais recente de cada veículo, mesmo antigo.
-- Execute no SQL Editor do Supabase. A função valida a sessão pelo token
-- usando o mesmo mecanismo das demais funções do aplicativo.
CREATE OR REPLACE FUNCTION public.app_ultimos_abastecimentos(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text := _sessao(p_token);
BEGIN
  RETURN COALESCE((
    SELECT json_agg(
      json_build_object(
        'placa', a.placa,
        'data_abast', a.data_abast,
        'motorista', a.motorista,
        'combustivel', a.combustivel,
        'posto', a.posto,
        'valor_total', a.valor_total,
        'valor_litro', a.valor_litro,
        'litros', a.litros,
        'odometro', a.odometro,
        'km_rodados', a.km_rodados,
        'consumo', a.consumo,
        'status', a.status,
        'criado_em', a.criado_em
      )
      ORDER BY a.placa, a.data_abast DESC, a.criado_em DESC, a.id DESC
    )
    FROM (
      SELECT
        a.placa, a.data_abast, a.motorista, a.combustivel, a.posto,
        a.valor_total, a.valor_litro, a.litros, a.odometro, a.km_rodados,
        a.consumo, a.status, a.criado_em, a.id
      FROM public.abastecimentos_pendentes AS a
      JOIN public.veiculos_pub AS v ON v.placa = a.placa
      WHERE a.status IN ('pendente', 'aprovado')
        AND (a.data_abast >= CURRENT_DATE - 30 OR a.id = (
          SELECT anterior.id FROM public.abastecimentos_pendentes AS anterior
          WHERE anterior.placa = a.placa AND anterior.status IN ('pendente', 'aprovado')
          ORDER BY anterior.data_abast DESC, anterior.criado_em DESC, anterior.id DESC
          LIMIT 1
        ))
    ) AS a
  ), '[]'::json);
END;
$function$;
