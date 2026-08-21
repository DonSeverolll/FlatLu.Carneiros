package br.com.carneirosflat.auth.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.DiscriminatorValue;

@Entity
@DiscriminatorValue("ADMIN")
public class Administrador extends Usuario {
    @Override
    public boolean podeAcessar(String recurso) {
        return true;
    }

    @Override
    public String perfil() { return "ADMIN"; }
}
