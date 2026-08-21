package br.com.carneirosflat.auth.security;

import br.com.carneirosflat.auth.domain.Usuario;
import br.com.carneirosflat.auth.domain.UsuarioRepository;
import java.util.List;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Peca que faltava.
 *
 * Sem um UserDetailsService, o `httpBasic()` do Spring Boot autenticava contra
 * o usuario em memoria gerado no boot - nunca contra a tabela `users`. Efeitos:
 * `/auth/me` estourava no `orElseThrow()` e a regra `hasRole("ADMIN")` era
 * inalcancavel, porque nenhuma authority vinha do banco.
 */
@Service
public class UsuarioDetailsService implements UserDetailsService {

    private final UsuarioRepository repository;

    public UsuarioDetailsService(UsuarioRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        Usuario usuario = repository.findAtivoByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("Usuario nao encontrado"));

        // `perfil()` vem do polimorfismo (Cliente/Administrador); o prefixo
        // ROLE_ e o que `hasRole` espera.
        return User.withUsername(usuario.getEmail())
                .password(usuario.getSenhaHash())
                .authorities(List.of(new SimpleGrantedAuthority("ROLE_" + usuario.perfil())))
                .disabled(!usuario.ativo())
                .build();
    }
}
