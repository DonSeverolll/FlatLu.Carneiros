package br.com.carneirosflat.auth.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.DiscriminatorValue;

@Entity
@DiscriminatorValue("CUSTOMER")
public class Cliente extends Usuario {
    @Override
    public boolean podeAcessar(String recurso) {
        return "RESERVAS_PROPRIAS".equals(recurso) || "PERFIL_PROPRIO".equals(recurso);
    }

    @Override
    public String perfil() { return "CUSTOMER"; }
}
