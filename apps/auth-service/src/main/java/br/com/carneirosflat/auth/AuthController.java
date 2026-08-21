package br.com.carneirosflat.auth;

import br.com.carneirosflat.auth.domain.Usuario;
import br.com.carneirosflat.auth.domain.UsuarioRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class AuthController {
    private final UsuarioRepository repository;

    public AuthController(UsuarioRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("ok");
    }

    @GetMapping("/me")
    public ResponseEntity<SessionResponse> me(Authentication authentication) {
        Usuario usuario = repository.findByEmailIgnoreCase(authentication.getName()).orElseThrow();
        return ResponseEntity.ok(new SessionResponse(usuario.getEmail(), usuario.getNomeCompleto(), usuario.perfil()));
    }

    public record SessionResponse(String email, String nome, String perfil) {}
}
