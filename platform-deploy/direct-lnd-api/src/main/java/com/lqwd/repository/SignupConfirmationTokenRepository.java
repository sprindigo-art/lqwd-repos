package com.lqwd.repository;

import com.lqwd.model.entities.SignupConfirmationToken;
import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SignupConfirmationTokenRepository extends CrudRepository<SignupConfirmationToken,Long> {

    Optional<SignupConfirmationToken> findByEmail(String email);

    List<SignupConfirmationToken> findAllByInviteCode(String inviteCode);

}