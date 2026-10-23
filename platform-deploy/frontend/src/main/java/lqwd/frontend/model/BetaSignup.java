package lqwd.frontend.model;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import javax.validation.constraints.Email;
import java.io.Serializable;
import java.util.Date;

@Entity
@Table(name = "beta")
@Getter
@Setter
public class BetaSignup implements Serializable {

    @Id
    @Email
    @Column(name="email", length = 50, unique = true)
    private String email;

    @Column(name="invite_code", length = 50, updatable = false)
    private String invite_code;

    @Column(name="used_by", length = 50, nullable = true)
    private Date used_by;

    @Column(name="created", insertable = false, updatable = false)
    @Temporal(TemporalType.DATE)
    private Date created;

    @Override
    public String toString(){

        return "\nBetaSignup\n"
                + "Email: " + this.getEmail() + "\n"
                + "Invite Code: " + this.getInvite_code() + "\n"
                + "Used By: " + this.getUsed_by() + "\n"
                + "Created: " + this.getCreated();
    }

}
