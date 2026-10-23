package com.lqwd.repository;

import com.lqwd.constants.ApplicationConstants;
import com.lqwd.model.entity.CipherMethod;
import com.lqwd.model.entity.LndFile;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import javax.transaction.Transactional;
import java.util.List;
import java.util.Optional;


@Repository
public interface LndFileRepository extends JpaRepository<LndFile, Long> {


    @Query(value = "select node_name from lnd_main_v2 group by node_name", nativeQuery = true)
    List<Object[]> getAllNodeNames();

    @Query(value = "select  c.name, l.sfile from lnd_main_v2 l left join cipher_method c on c.id = l.cipher_method where l.id = ?1", nativeQuery = true)
    List<Object[]> getFileContentAndMethodById(Long fileId);

    @Query(value = "select  c.name, l.sfile from lnd_main_v2 l left join cipher_method c on c.id = l.cipher_method where  l.file_name like( ?1 ) and  l.node_name = ?2", nativeQuery = true)
    List<Object[]> getFileContentAndMethodByFileNameAndNode(String fileName, String nodeName);

    @Query(value="select count(*) from  lnd_main_v2  where file_name like( ?1 ) and node_name = ?2", nativeQuery = true)
    int existByFileNameAndNodeName(String fileName, String nodeName);

    @Query(value = "select l.id, l.node_name, l.file_name, l.cipher_method, c.name from lnd_main_v2 l left join cipher_method c on c.id = l.cipher_method", countQuery = "select count(id) from lnd_main_v2", nativeQuery = true)
    Page<Object[]> getAllFiles(Pageable page);

    @Query(value = "select l.id, l.node_name, l.file_name, l.cipher_method,  c.name from lnd_main_v2 l left join cipher_method c on c.id = l.cipher_method where l.file_name like( ?1 ) or l.node_name like( ?1 )", countQuery = "select count(id) from lnd_main_v2 where file_name like( ?1 ) or node_name like( ?1 )", nativeQuery = true)
    Page<Object[]> searchFiles(String query, Pageable page);

    @Query(value = "select id, node_name, file_name, cipher_method from lnd_main_v2 where node_name like( ?1 )", countQuery = "select count(id) from lnd_main_v2 where node_name like( ?1 )", nativeQuery = true)
    Page<Object[]> getAllFilesByLnd(String query, Pageable page);

    @Query(value = "select id, node_name, file_name, cipher_method from lnd_main_v2 where file_name like( ?1 )", countQuery = "select count(id) from lnd_main_v2 where file_name like( ?1 )", nativeQuery = true)
    Page<Object[]> getAllFilesByFileType(String query, Pageable page);

    @Modifying(clearAutomatically = true)
    @Query(value="UPDATE lnd_main_v2  SET queued_for_update = true, cipher_method_update = ?2 WHERE cipher_method = ?1", nativeQuery = true)
    int setQueuedForUpdateByMethod(Long method, Long updateId);


    @Query(value="select count(*) from  lnd_main_v2  WHERE cipher_method = ?1", nativeQuery = true)
    int countFilesWithMethod(Long methodId);


    @Query(value="select count(*) from  lnd_main_v2", nativeQuery = true)
    int countFiles();


    @Modifying
    @Transactional
    @Query(value="UPDATE lnd_main_v2 set node_name=?1 where node_name = ?2", nativeQuery = true)
    void clearLndFiles(String newNodeName, String nodeName);

    @Modifying(clearAutomatically = true)
    @Query(value="UPDATE lnd_main_v2  SET queued_for_update = true, cipher_method_update = ?1", nativeQuery = true)
    int setQueuedForUpdate(Long updateId);

    @Transactional
    @Modifying(clearAutomatically = true)
    @Query(value="UPDATE LndFile p  SET p.queuedForUpdate = true, p.cipherMethodUpdate = :update where p.id in :ids")
    int setQueuedForUpdateByFiles(@Param("update") Long update, @Param("ids") List<Long> ids);


    @Transactional
    @Modifying(clearAutomatically = true)
    @Query(value="UPDATE LndFile p SET p.cipherKeyUpdate = :update where p.isUserFile = false and p.cipherMethod <> 0")
    int setKeyUpdate(@Param("update") Long update);

    @Query(value = "select p from LndFile p  where p.cipherKeyUpdate is not null")
    List<LndFile> getAllFilesToBeUpdatedByKey(Pageable page);

    @Query(value = "select p from LndFile p  where p.queuedForUpdate = true")
    List<LndFile> getAllFilesForUpdate(Pageable page);

    @Query(value = "select p from LndFile p  where p.cipherMethod = :method")
    List<LndFile> getAllFilesByMethod(@Param("method") Long method);

    @Query(value = "select p from  LndFile p  where p.id in :ids")
    List<LndFile> getAllFilesInIds(@Param("ids") List<Long> ids);

    @Query(value = "select id, sfile, cipher_method,  cipher_method_update from lnd_main_v2", nativeQuery = true)
    List<Object[]> getAllFiles();

    @Query(value = "select p from LndFile p  where p.isUserFile = true and p.nodeName = :nodeName")
    List<LndFile> getAllUserFilesByNode(@Param("nodeName") String nodeName);


}
