package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.ApiKey;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ApiKeyRepository extends PagingAndSortingRepository<ApiKey, UUID> {

    @Query(value = "SELECT * FROM user_apikey p where p.apikey = ?1 and p.status='active'", nativeQuery = true)
    Optional<ApiKey> findByApiKey(@Param("apikey") String apikey);
    
    @Query(value = "SELECT * FROM user_apikey p where p.user_id = ?1", nativeQuery = true)
    List<ApiKey> findAllByUser(@Param("user_id") UUID user_id);
}
