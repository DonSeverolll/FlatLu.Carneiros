package br.com.carneirosflat.auth;

import br.com.carneirosflat.auth.domain.Usuario;
import br.com.carneirosflat.auth.domain.UsuarioRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

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
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        // 401 em vez do 500 que o orElseThrow() sem argumento produzia.
        Usuario usuario = repository.findAtivoByEmail(authentication.getName())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        return ResponseEntity.ok(new SessionResponse(
                usuario.getEmail(), usuario.getNomeCompleto(), usuario.perfil()));
    }

    @GetMapping("/admin/ping")
    public ResponseEntity<String> adminPing() {
        // Prova que a regra hasRole("ADMIN") passou a ser alcancavel: antes
        // nenhuma authority vinha do banco.
        return ResponseEntity.ok("admin ok");
    }

    public record SessionResponse(String email, String nome, String perfil) {}
}
