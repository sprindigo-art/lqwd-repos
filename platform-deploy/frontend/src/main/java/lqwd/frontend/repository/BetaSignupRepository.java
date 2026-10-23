package lqwd.frontend.repository;

import lqwd.frontend.model.BetaSignup;
import lqwd.frontend.model.BitcoinPrice;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface BetaSignupRepository extends CrudRepository<BetaSignup,Long> {

    @Query(value="SELECT * FROM beta WHERE email = ?1", nativeQuery = true)
    BetaSignup findUserByEmail(String email);

    @Query(value = "SELECT * FROM beta WHERE invite_code = ?1", nativeQuery = true)
    BetaSignup findUserByInviteCode(String invite_code);

}
