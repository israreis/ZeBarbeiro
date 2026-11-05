import { api } from '../core/api.js';
import { byId, withBusy } from '../core/dom.js';
import {
  applyPhoneMask, isFormValid, rawValue, setMatchValidity, value,
} from '../core/forms.js';
import { ageOn, todayIso } from '../core/format.js';

/** Mesma regra e mensagem do servidor (que é quem garante a validação). */
const IDADE_MINIMA = 16;
const MENSAGEM_MENOR_DE_IDADE = `Clientes menores de ${IDADE_MINIMA} anos precisam que um responsável `
  + 'faça o agendamento. Se preferir, fale com a barbearia pelo telefone (31) 91234-5678.';
import { HOME_BY_ROLE, getSession, saveSession } from '../core/session.js';
import { errorMessage, setFormError } from '../components/auth-form.js';
import { enhanceForms } from '../core/form-enhancements.js';

/** Força estimada da senha (0 a 3) para orientar o usuário enquanto digita. */
function passwordStrength(password) {
  if (password.length < 8) return password ? 1 : 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  return variety >= 3 || password.length >= 14 ? 3 : 2;
}

const session = getSession();
if (session) {
  window.location.replace(HOME_BY_ROLE[session.usuario.perfil]);
} else {
  const form = byId('form-cadastro');
  const submit = form.querySelector('[type="submit"]');
  const strength = form.querySelector('[data-strength]');
  enhanceForms(form);
  applyPhoneMask(form.elements.telefone);

  form.elements.dataNascimento.max = todayIso();
  form.elements.senha.addEventListener('input', () => {
    strength.dataset.level = String(passwordStrength(rawValue(form, 'senha')));
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setFormError(form, null);
    setMatchValidity(form, 'senha', 'confirmarSenha', 'As senhas não coincidem.');
    if (!isFormValid(form)) return;

    const nascimento = value(form, 'dataNascimento');
    if (ageOn(nascimento, todayIso()) < IDADE_MINIMA) {
      setFormError(form, MENSAGEM_MENOR_DE_IDADE);
      form.elements.dataNascimento.focus();
      return;
    }

    withBusy(submit, async () => {
      submit.textContent = 'Criando conta...';
      const credenciais = { email: value(form, 'email'), senha: rawValue(form, 'senha') };
      try {
        await api.post('/clientes', {
          ...credenciais,
          nome: value(form, 'nome'),
          telefone: value(form, 'telefone'),
          dataNascimento: value(form, 'dataNascimento'),
        });
      } catch (error) {
        setFormError(form, errorMessage(error));
        submit.textContent = 'Criar conta';
        return;
      }

      // Conta criada: entra automaticamente e segue para o agendamento.
      try {
        const novaSessao = await api.post('/auth/login', credenciais);
        saveSession(novaSessao, false);
        window.location.assign(HOME_BY_ROLE[novaSessao.usuario.perfil]);
      } catch {
        window.location.assign(`login.html?email=${encodeURIComponent(credenciais.email)}`);
      }
    });
  });
}
