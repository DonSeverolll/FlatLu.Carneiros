package br.com.carneirosflat.auth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.DiscriminatorColumn;
import jakarta.persistence.DiscriminatorType;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Inheritance;
import jakarta.persistence.InheritanceType;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Heranca SINGLE_TABLE sobre a coluna `role`, que no PostgreSQL e do tipo
 * enumerado `user_role`. O discriminador e lido como texto (o driver devolve o
 * rotulo do enum), por isso `columnDefinition` aponta o tipo real - sem isso o
 * `ddl-auto: validate` acusa divergencia de tipo.
 */
@Entity
@Table(name = "users")
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name = "role", discriminatorType = DiscriminatorType.STRING,
        columnDefinition = "user_role")
public abstract class Usuario {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String senhaHash;

    @Column(name = "full_name", nullable = false)
    private String nomeCompleto;

    @Column(name = "status", nullable = false, insertable = false, updatable = false,
            columnDefinition = "user_status")
    private String status;

    @Column(name = "deleted_at", insertable = false, updatable = false)
    private OffsetDateTime excluidoEm;

    public abstract boolean podeAcessar(String recurso);

    public abstract String perfil();

    /** So usuario ativo e nao excluido pode autenticar. */
    public boolean ativo() {
        return "ACTIVE".equals(status) && excluidoEm == null;
    }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public String getSenhaHash() { return senhaHash; }
    public String getNomeCompleto() { return nomeCompleto; }
    public String getStatus() { return status; }
    public OffsetDateTime getExcluidoEm() { return excluidoEm; }
    public void setEmail(String email) { this.email = email; }
    public void setSenhaHash(String senhaHash) { this.senhaHash = senhaHash; }
    public void setNomeCompleto(String nomeCompleto) { this.nomeCompleto = nomeCompleto; }
}
