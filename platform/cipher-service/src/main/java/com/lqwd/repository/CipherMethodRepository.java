package com.lqwd.repository;

import com.lqwd.model.entity.CipherMethod;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import javax.transaction.Transactional;
import java.util.Optional;

@Repository
public interface CipherMethodRepository extends JpaRepository<CipherMethod, Long> {

    @Query(value = "SELECT p FROM CipherMethod p where p.name = :name and isActive = true")
    Optional<CipherMethod> findByName(@Param("name") String name);

    @Modifying(clearAutomatically = true)
    @Query(value="UPDATE CipherMethod c SET c.isActive = false where c.name = :name")
    @Transactional
    int clearAllActive(@Param("name") String name);


    @Modifying(clearAutomatically = true)
    @Transactional
    @Query(value="DELETE from CipherMethod c where c.isActive = false")
    int deleteNonActive();


    @Modifying
    @Query(value="update default_cipher_method set name = ?1", nativeQuery = true)
    @Transactional
    void updateDefault(String name);

    @Modifying
    @Query(value="insert into default_cipher_method values('AEAD')", nativeQuery = true)
    @Transactional
    void setAEADDefault();

    @Query(value="select name from default_cipher_method", nativeQuery = true)
    @Transactional
    String loadDefaultMethodName();

    @Query(value = "SELECT p.* FROM cipher_method p where p.is_active = true and  p.name = (select name from default_cipher_method)", nativeQuery = true)
    Optional<CipherMethod> findDefault();
}
