package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.AccountInfo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import javax.persistence.Id;


@Repository
public interface AccountInfoRepository extends JpaRepository<AccountInfo, Id> {


}
