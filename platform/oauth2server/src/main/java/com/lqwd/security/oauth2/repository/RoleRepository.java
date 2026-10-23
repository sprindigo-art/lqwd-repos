package com.lqwd.security.oauth2.repository;

import com.lqwd.security.oauth2.model.security.Mservice;
import com.lqwd.security.oauth2.model.security.Role_;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import javax.transaction.Transactional;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface RoleRepository extends PagingAndSortingRepository<Role_, UUID> {
    Optional<Role_> findByName(String name);

    Optional<Role_> findByMserviceId(UUID uuid);

    Collection<Role_> findAllByMservice(Mservice mservice);

    @Query(value = "SELECT * FROM role_ p where p.status='active'", nativeQuery = true)
    Page<Role_> findAllNonDeleted(Pageable pageable);

    @Query(value = "SELECT * FROM role_ p where p.status='active'", nativeQuery = true)
    List<Role_> listAllNonDeleted();

    @Query(value = "SELECT * FROM role_ p where p.mservice_id = ?1 and p.status='active'", nativeQuery = true)
    Collection<Role_> findNonDeletedByMservice(@Param("mserviceId") UUID mserviceUUID);

    @Query(value = "SELECT * FROM role_ p where p.mservice_id = ?1 and p.status='active' and p.name=?2 LIMIT 1", nativeQuery = true)
    Optional<Role_> findNonDeletedByMserviceAndRole(@Param("mserviceId") UUID mserviceUUID, @Param("roleName") String name);

    @Query(value = "DELETE FROM role_ p where p.mservice_id = ?1", nativeQuery = true)
    void deleteAllByMService(@Param("mserviceId") UUID mserviceUUID);

    @Query("SELECT e FROM Role_ e WHERE e.id IN (:ids)")
    List<Role_> findByIds(@Param("ids")List<UUID> ids);

    @Query(value = "SELECT name from role_label", nativeQuery = true)
    List<String> getRoleLabels();

    @Query(value="select name from role_ r inner join user_role ur on ur.role_id = r.id inner join user_ u on u.id = ur.user_id where u.id = ?1 and r.status='active'", nativeQuery = true)
    List<String> getUserRoles(UUID id);
    
    @Modifying
    @Query(value="insert into role_label values(?)", nativeQuery = true)
    @Transactional
    void addRoleLabel(String label);

    @Query(value = "SELECT count(*) from role_label where name = ?", nativeQuery = true)
    int checkRoleExist(String label);


}
