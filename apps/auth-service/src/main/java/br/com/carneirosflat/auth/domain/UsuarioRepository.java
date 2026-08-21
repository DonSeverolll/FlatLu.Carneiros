package br.com.carneirosflat.auth.domain;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Optional;
import java.util.UUID;

public interface UsuarioRepository extends JpaRepository<Usuario, UUID> {

    Optional<Usuario> findByEmailIgnoreCase(String email);

    /**
     * Busca usada na autenticacao: ignora excluidos logicamente, espelhando a
     * clausula que a API Node aplica no login.
     */
    @Query("select u from Usuario u where lower(u.email) = lower(:email) and u.excluidoEm is null")
    Optional<Usuario> findAtivoByEmail(@Param("email") String email);
}
