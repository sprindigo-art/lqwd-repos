package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.Mservice;
import com.lqwd.security.oauth2.model.security.OauthClientDetails;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface OauthClientDetailsRepository extends PagingAndSortingRepository<OauthClientDetails, String> {


    @Query(value = "SELECT * FROM oauth_client_details p where p.additional_information is NULL", nativeQuery = true)
    Page<OauthClientDetails> findAllNonDeleted(Pageable pageble);

    @Query(value = "SELECT * FROM oauth_client_details p where p.client_id = ?1", nativeQuery = true)
    Optional<OauthClientDetails> findByClient(@Param("clientid") String clientid);

    @Query(value = "SELECT * FROM oauth_client_details p where p.additional_information is NULL", nativeQuery = true)
    List<OauthClientDetails> listFindAllNonDeleted();
}
