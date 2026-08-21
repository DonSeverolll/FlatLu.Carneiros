# auth-service (opcional — não faz parte do deploy)

Serviço Spring Boot que autentica contra a mesma tabela `users` da aplicação
principal, usando HTTP Basic e Argon2. Existe como alternativa/estudo de
back-end Java; **a autenticação em produção é a da aplicação Next.js**
(`apps/web`), com sessão por cookie e refresh token rotativo.

## O que foi corrigido

Antes, o serviço não autenticava ninguém do banco:

- não havia `UserDetailsService`, então o `httpBasic()` caía no usuário em
  memória gerado pelo Spring Boot no boot;
- `GET /auth/me` estourava no `orElseThrow()` sem argumento (500, não 401);
- nenhuma authority era derivada de `Usuario`, então `hasRole("ADMIN")` era
  uma regra inalcançável;
- a entidade não conhecia `status` nem `deleted_at`, então usuário suspenso ou
  excluído autenticaria normalmente.

Agora existe `UsuarioDetailsService`, ligado por um `DaoAuthenticationProvider`,
que carrega o usuário pelo e-mail, recusa inativos e mapeia
`perfil()` → `ROLE_CUSTOMER` / `ROLE_ADMIN`.

## Aviso honesto

Estas correções **não foram compiladas nem executadas**: a máquina onde foram
escritas não tem JDK nem Maven. O padrão é o convencional do Spring Security,
mas trate como não verificado até rodar:

```bash
cd apps/auth-service
mvn spring-boot:run
```

Dois pontos merecem atenção na primeira execução:

1. `role` e `status` são tipos enumerados do PostgreSQL. O mapeamento usa
   `columnDefinition` para o `ddl-auto: validate` não acusar divergência — se
   ainda reclamar, é aqui que se ajusta.
2. `DATABASE_URL` neste serviço é JDBC
   (`jdbc:postgresql://host:5432/base`), diferente da connection string da
   aplicação Next.js.

Se a intenção for só ter uma autenticação, este módulo pode ser removido sem
impacto no site.
