package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.ConfirmationToken;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository("confirmationTokenRepository")
public interface ConfirmationTokenRepository extends CrudRepository<ConfirmationToken, String> {
    ConfirmationToken findByConfirmationToken(String confirmationToken);

    @Query(value = "SELECT p.* FROM confirmation_token p where p.user_id = ?1 ORDER BY p.created_date DESC LIMIT 1 ", nativeQuery = true)
    ConfirmationToken findByUserid(UUID userid);
}
