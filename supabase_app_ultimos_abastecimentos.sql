-- Histórico compartilhado: último abastecimento ativo de cada placa.
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
        'status', a.status
      )
      ORDER BY a.placa
    )
    FROM (
      SELECT DISTINCT ON (placa)
        placa, data_abast, motorista, combustivel, posto, valor_total,
        valor_litro, litros, odometro, km_rodados, consumo, status
      FROM public.abastecimentos_pendentes
      WHERE status IN ('pendente', 'aprovado')
      ORDER BY placa, data_abast DESC, criado_em DESC, id DESC
    ) AS a
  ), '[]'::json);
END;
$function$;
