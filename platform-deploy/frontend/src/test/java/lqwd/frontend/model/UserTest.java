package lqwd.frontend.model;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class UserTest {
	static User user;
	
	@BeforeAll
	static void init() {
	user = new User();	
	}
	
	@Test
	void testGetId() {
		user.setId("test");
		assertEquals("test", user.getId());
	}

	@Test
	void testSetId() {
		user.setId("xyz");
		assertEquals("xyz", user.getId());
	}

	@Test
	void testGetFa2secret() {
		user.setFa2secret("test");
		assertEquals("test", user.getFa2secret());
	}

	@Test
	void testSetFa2secret() {
		user.setFa2secret("xyz");
		assertEquals("xyz", user.getFa2secret());
	}

	@Test
	void testGetEmail() {
		user.setEmail("test@test.com");
		assertEquals("test@test.com", user.getEmail());
	}

	@Test
	void testSetEmail() {
		user.setEmail("xyz@test.com");
		assertEquals("xyz@test.com", user.getEmail());
	}

	@Test
	void testGetUsername() {
		user.setUsername("test");
		assertEquals("test", user.getUsername());
	}

	@Test
	void testSetUsername() {
		user.setUsername("xyz");
		assertEquals("xyz", user.getUsername());
	}

	@Test
	void testGetPassword() {
		user.setPassword("test");
		assertEquals("test", user.getPassword());
	}

	@Test
	void testSetPassword() {
		user.setPassword("xyz");
		assertEquals("xyz", user.getPassword());
	}

	@Test
	void testGetFullName() {
		user.setFirstName("test");
		user.setLastName("xyz");
		assertEquals("test xyz", user.getFullName());
	}

	@Test
	void testGetFirstName() {
		user.setFirstName("test");
		assertEquals("test", user.getFirstName());
	}

	@Test
	void testSetFirstName() {
		user.setFirstName("test");
		assertEquals("test", user.getFirstName());
	}

	@Test
	void testGetLastName() {
		user.setLastName("xyz");
		assertEquals("xyz", user.getLastName());
	}

	@Test
	void testSetLastName() {
		user.setLastName("xyz");
		assertEquals("xyz", user.getLastName());
	}

	@Test
	void testGetPhone() {
		user.setPhone("12345");
		assertEquals("12345", user.getPhone());
	}

	@Test
	void testSetPhone() {
		user.setPhone("6789");
		assertEquals("6789", user.getPhone());
	}

	@Test
	void testGetActive() {
		user.setActive(1);
		assertEquals(1, user.getActive());
	}

	@Test
	void testSetActive() {
		user.setActive(0);
		assertEquals(0, user.getActive());
	}

	@Test
	void testGetRoles() {
		String roles = new String();
		user.setRoles(roles);
		assertEquals(roles, user.getRoles());
	}

	@Test
	void testSetRoles() {
		String roles = new String();
		user.setRoles(roles);
		assertEquals(roles, user.getRoles());
	}

	@Test
	void testIsFa2() {
		user.setFa2(true);
		assertEquals(true, user.isFa2());
	}

	@Test
	void testSetFa2() {
		user.setFa2(false);
		assertEquals(false, user.isFa2());
	}

	@Test
	void testIsReceiveNews() {
		user.setReceiveNews(true);
		assertEquals(true, user.isReceiveNews());
	}

	@Test
	void testSetReceiveNews() {
		user.setReceiveNews(false);
		assertEquals(false, user.isReceiveNews());
	}

	@Test
	void testGetApiKeyList() {
		User usr =new User();
		ApiKey apikey = new ApiKey();
		apikey.setStatus("");
		usr.addApiKeyList(apikey);
		assertEquals(1, usr.getApiKeyList().size());
	}

	@Test
	void testAddApiKeyList() {
		User usr =new User();
		ApiKey apikey = new ApiKey();
		apikey.setStatus("");
		usr.addApiKeyList(apikey);
		assertEquals(1, usr.getApiKeyList().size());
	}

	@Test
	void testGetToken() {
		user.setToken("test");
		assertEquals("test", user.getToken());
	}

	@Test
	void testSetToken() {
		user.setToken("xyz");
		assertEquals("xyz", user.getToken());
	}
/*
	@Test
	void testMapContent() {
		fail("Not yet implemented");
	}

	@Test
	void testMapApiKeyContent() {
		fail("Not yet implemented");
	}

*/
}
