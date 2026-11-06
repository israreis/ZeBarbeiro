/**
 * Popula o projeto Supabase com os dados de exemplo de data/seed.json.
 *
 *   npm run db:seed
 *
 * - Cria os logins no Supabase Auth (senha: SEED_PASSWORD ou "barber123").
 * - Grava perfis, serviços, barbeiros e agendamentos.
 * - Pode ser executado mais de uma vez: o que já existe é reaproveitado.
 */
import fs from 'node:fs/promises';
import { baseConfig, loadConfig, loadEnvFile } from '../server/config.js';
import { createSupabaseClients } from '../server/infra/supabase/client.js';
import { slotEnd } from '../server/domain/agenda.js';

loadEnvFile();
const config = loadConfig();
const { admin } = createSupabaseClients(config.supabase);
const senhaPadrao = process.env.SEED_PASSWORD || 'barber123';
const seed = JSON.parse(await fs.readFile(baseConfig.seedFile, 'utf8'));

function check({ data, error }, contexto) {
  if (error) throw new Error(`${contexto}: ${error.message}`);
  return data;
}

async function listarUsuariosAuth() {
  const usuarios = [];
  for (let page = 1; ; page += 1) {
    const { users } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }), 'Listar usuários');
    usuarios.push(...users);
    if (users.length < 1000) return usuarios;
  }
}

// 1) Usuários: login no Auth + perfil na aplicação ------------------------------
const existentes = await listarUsuariosAuth();
const idDoSeed = new Map(); // id do seed.json -> uuid do Supabase

for (const usuario of seed.usuarios) {
  let id = existentes.find((u) => u.email === usuario.email)?.id;
  if (!id) {
    const { user } = check(await admin.auth.admin.createUser({
      email: usuario.email, password: senhaPadrao, email_confirm: true,
    }), `Criar login de ${usuario.email}`);
    id = user.id;
  }
  idDoSeed.set(usuario.id, id);
  check(await admin.from('perfis').upsert({
    id,
    nome: usuario.nome,
    email: usuario.email,
    telefone: usuario.telefone,
    data_nascimento: usuario.dataNascimento,
    perfil: usuario.perfil,
  }), `Salvar perfil de ${usuario.email}`);
}
console.log(`✔ ${seed.usuarios.length} usuários`);

// 2) Serviços (identificados pelo nome) -----------------------------------------
const servicosAtuais = check(await admin.from('servicos').select('id, nome, valor'), 'Listar serviços');
const servicoDoSeed = new Map(); // id do seed.json -> { id, valor }

for (const servico of seed.servicos) {
  let atual = servicosAtuais.find((s) => s.nome.toLowerCase() === servico.nome.toLowerCase());
  if (!atual) {
    atual = check(await admin.from('servicos').insert({
      nome: servico.nome, valor: servico.valor, duracao_minutos: servico.duracaoMinutos, ativo: servico.ativo,
    }).select('id, nome, valor').single(), `Criar serviço ${servico.nome}`);
  }
  servicoDoSeed.set(servico.id, { id: atual.id, valor: Number(atual.valor) });
}
console.log(`✔ ${seed.servicos.length} serviços`);

// 3) Barbeiros (perfil + expediente + serviços numa transação) -------------------
for (const barbeiro of seed.barbeiros) {
  const usuario = seed.usuarios.find((u) => u.id === barbeiro.id);
  check(await admin.rpc('salvar_barbeiro', {
    p_id: idDoSeed.get(barbeiro.id),
    p_nome: usuario.nome,
    p_email: usuario.email,
    p_telefone: usuario.telefone,
    p_data_nascimento: usuario.dataNascimento,
    p_ativo: barbeiro.ativo,
    p_horario_inicial: barbeiro.horarioInicial,
    p_horario_final: barbeiro.horarioFinal,
    p_dias: barbeiro.diasDisponiveis,
    p_servicos: barbeiro.servicoIds.map((id) => servicoDoSeed.get(id).id),
  }), `Salvar barbeiro ${usuario.email}`);
}
console.log(`✔ ${seed.barbeiros.length} barbeiros`);

// 4) Agendamentos (ids fixos: reexecutar não duplica) ---------------------------
const agendamentos = seed.agendamentos.map((ag) => {
  const servico = ag.servicoId ? servicoDoSeed.get(ag.servicoId) : null;
  return {
    id: ag.id,
    barbeiro_id: idDoSeed.get(ag.barbeiroId),
    cliente_id: ag.clienteId ? idDoSeed.get(ag.clienteId) : null,
    cliente_nome: ag.clienteNome ?? null,
    servico_id: servico?.id ?? null,
    valor: servico?.valor ?? null,
    data: ag.data,
    horario_inicio: ag.horarioInicio,
    horario_fim: ag.horarioFim ?? slotEnd(ag.horarioInicio),
    status: ag.status,
  };
});
check(
  await admin.from('agendamentos').upsert(agendamentos, { onConflict: 'id', ignoreDuplicates: true }),
  'Salvar agendamentos',
);
console.log(`✔ ${agendamentos.length} agendamentos`);

console.log(`\nPronto! Todos os usuários de exemplo usam a senha "${senhaPadrao}".`);
