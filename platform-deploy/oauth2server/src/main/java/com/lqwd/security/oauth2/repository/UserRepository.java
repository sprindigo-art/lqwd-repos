package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.Role_;
import com.lqwd.security.oauth2.model.security.User_;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserRepository extends PagingAndSortingRepository<User_, UUID> {

    @Override
    @EntityGraph(attributePaths = {"userDetails","accountInfo"})
    Page<User_> findAll(Pageable var1);


    Optional<User_> findByUsernameOrEmail(String username,String email);


    @Query(value = "SELECT cast(u.id as varchar) id, ud.firstname, ud.lastname,  u.created_date, u.updated_at, u.email,  (SELECT count(id) from lndnodeinfo WHERE user_id=u.id) as no_lnd_nodes, " +
            "(SELECT count(id) from user_apikey WHERE user_id=u.id) as no_api_keys, at.name as  account_name, u.account_expired, u.status, last_access_date, u.user_name " +
            "FROM user_ u left join user_details ud on ud.user_id = u.id left join accountinfo ai on ai.user_id = u.id left join accounttype at on ai.account_type = at.id " +
            "ORDER BY u.created_date DESC ",
            countQuery = "select count(id) from user_", nativeQuery = true)
    Page<Object[]> getAllWithLndNodeAndApiKeyCount(Pageable page);


    @Query(value = "SELECT cast(u.id as varchar) id, ud.firstname, ud.lastname, u.created_date, u.updated_at, u.email,  (SELECT count(id) from lndnodeinfo WHERE user_id=u.id) as no_lnd_nodes, " +
            "(SELECT count(id) from user_apikey WHERE user_id=u.id) as no_api_keys, at.name as  account_name, u.account_expired, u.status, last_access_date, u.user_name " +
            "FROM user_ u left join user_details ud on ud.user_id = u.id left join accountinfo ai on ai.user_id = u.id " +
            "left join accounttype at on ai.account_type = at.id where u.user_name  like( ?1 ) or u.email like  ( ?1 ) ORDER BY u.created_date DESC ",
            countQuery = "select count(id) from user_ u where u.user_name  like( ?1 ) or u.email like  ( ?1 )", nativeQuery = true)
    Page<Object[]> getAllWithLndNodeAndApiKeyCountByQuery(String query, Pageable page);


//    @Query(value = "SELECT p.* FROM user_ p where p.user_name = ?1", nativeQuery = true)
//    Optional<User_> findByUsername(String username);

    Optional<User_> findByUsername(String username);


    @Query(value = "SELECT p.* FROM user_ p where p.user_name = ?1  and p.id <> ?2", nativeQuery = true)
    Optional<User_> findByUsernameAndNotId(String username, UUID id);

    @Query(value = "SELECT p.* FROM user_ p where p.email = ?1", nativeQuery = true)
    Optional<User_> findByEmail(String email);


    @Query(value = "SELECT p.* FROM user_ p where p.email = ?1  and p.id <> ?2", nativeQuery = true)
    Optional<User_> findByEmailAndNotId(String username, UUID id);

    @Query(value = "SELECT p.* FROM user_ p where p.user_name = ?1 or p.email = ?1",
            countQuery = "select count(p.* ) from user_ p where p.user_name = ?1 or p.email = ?1", nativeQuery = true)
    Page<User_> findByUsernameOrEmail(String usernameOremail, Pageable page);

    @Query(value = "SELECT p.* FROM user_ p, oauth_access_token op where p.user_name = op.user_name and  op.token_id = ?1", nativeQuery = true)
    Optional<User_> findByToken(@Param("token") String token);


    @Query(value = "DELETE FROM oauth_access_token p where p.user_name = ?1", nativeQuery = true )
    void deleteToken(String username);

    @Query(value = "SELECT p.* FROM user_ p where p.status = ?1", nativeQuery = true)
    List<User_> findAllByStatus(String status);


    @Query(value = "select r.name from user_role ur left join role_ r on r.id = ur.role_id left join user_ u on u.id = ur.user_id " +
            "left join mservice m on m.id = r.mservice_id where u.user_name = ?1 and m.client_id = ?2", nativeQuery = true)
    List<String> getUserRoles(String username, String clientId);


    @Query(value = "select cast(r.id as varchar) as id ,  cast(m.client_id as varchar) as client_id from user_role ur " +
            "left join role_ r on r.id = ur.role_id left join user_ u on u.id = ur.user_id left join mservice m on m.id = r.mservice_id where u.id = ?1", nativeQuery = true)
    List<Object[]> getUserRolesByUserId(UUID id);

}
